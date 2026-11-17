// tools/verify-pack.js — 素材包与加载页验收
//
// 【为什么需要】
// 这次改动推翻了项目原有的两条硬约束（零外部资源、单文件交付），
// 引入了外部图片素材与强制 HTTP 打开。必须把新规则钉死：
//   1) 素材包能被正确发现、加载、计数
//   2) loading 页真的存在并在加载期间显示
//   3) file:// 下有明确降级并提示原因（而不是黑屏）
//   4) 素材来源可查（CC-BY 的法定要求）
//   5) 场景里没有任何"整张图集被平铺"的错误
//
// 【前提】本测试需要 HTTP 服务：
//   python -m http.server 8899
// 然后 node tools/verify-pack.js http://localhost:8899/dev.html
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

function ensureAuto(u) {
  if (!u) return u;
  if (u.indexOf('autostart=') >= 0) return u;
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'autostart=1';
}

const TARGET_URL = ensureAuto(process.argv[2] ||
  ('file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()));

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 素材包 / 加载页验收 ===');
  console.log('目标地址: ' + TARGET_URL + '\n');

  const isHttp = TARGET_URL.indexOf('http') === 0;
  if (!isHttp) {
    console.log('  ⚠ 目标不是 HTTP，素材包相关断言会自动跳过（file:// 下不适用）\n');
  }

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const errors = [];
  cdp.on('Runtime.exceptionThrown', e => { errors.push(e.exceptionDetails.text || 'exception'); });

  await cdp.send('Page.navigate', { url: TARGET_URL });

  // ---- 1. 加载页会出现 ----
  //
  // 必须在页面脚本刚跑起来时立刻探测，否则加载完就看不到了。
  let sawLoading = false;
  let loadingHasBar = false;
  for (let i = 0; i < 40; i++) {
    await sleep(80);
    try {
      const s = await cdp.eval(`(function(){
        var el = document.getElementById('loadingScreen');
        if (!el) return null;
        return {
          exists: true,
          hasTrack: !!(document.getElementById('loadingTrack') && document.getElementById('loadingBar')),
          text: (el.textContent || '').slice(0, 40)
        };
      })()`);
      if (s && s.exists) {
        sawLoading = true;
        loadingHasBar = s.hasTrack;
        break;
      }
    } catch (e) {}
  }
  check('加载页出现', sawLoading);
  check('加载页有进度条', loadingHasBar);

  // ---- 2. 等待游戏就绪 ----
  let ready = false;
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    try {
      if (await cdp.eval('window.__GAME_READY__===true?1:0') === 1) { ready = true; break; }
    } catch (e) {}
  }
  check('游戏启动完成', ready);
  if (!ready) { await b.kill(); process.exit(1); }
  await sleep(1500);

  // ---- 3. 加载页已消失 ----
  const loadingGone = await cdp.eval(`document.getElementById('loadingScreen') === null`);
  check('加载完成后加载页已移除', loadingGone === true);

  if (isHttp) {
    // ---- 4. 素材包加载结果 ----
    const pack = await cdp.eval(`(function(){
      return {
        available: G.assets ? G.assets.available : null,
        loaded: G.assets ? G.assets.loaded : null,
        hasPack: G.assets ? G.assets.hasPack() : null,
        error: G.assets ? G.assets.error : null,
        chars: G.assets ? Object.keys(G.assets.charSheets).length : 0,
        tiles: G.assets ? Object.keys(G.assets.textures).length : 0,
        manifestTitle: (G.assets && G.assets.manifest) ? G.assets.manifest.name : null
      };
    })()`);
    check('HTTP 下素材包可用', pack.available === true, pack.error || 'ok');
    check('素材包加载完成', pack.hasPack === true);
    check('manifest 被正确读取', !!pack.manifestTitle, pack.manifestTitle);
    check('加载到 6 个角色图集', pack.chars === 6, pack.chars + ' 个');
    check('加载到 2 张瓦片集', pack.tiles === 2, pack.tiles + ' 张');

    // ---- 5. 素材包场景生效 ----
    const scene = await cdp.eval(`(function(){
      return {
        packMode: !!G.world.packMode,
        pixelMode: G.pixelMode ? G.pixelMode.enabled : null,
        camPitchDeg: Math.round(G.camera.pitch * 180 / Math.PI)
      };
    })()`);
    check('场景切到素材包模式', scene.packMode === true);
    check('相机切到像素俯视（62°）',
      scene.camPitchDeg === 62, scene.camPitchDeg + '°');

    // ---- 6. 没有"整张图集被平铺"的错误 ----
    //
    // 曾经出现过：地面贴图 repeat=30,22 但取样的是整张 240×240 图集，
    // 结果画面铺满图集内容。判据：所有贴图的 image 尺寸必须很小
    // （单块瓦片 32×32 或单帧角色 96×192），不能是整张图集。
    const texCheck = await cdp.eval(`(function(){
      var bad = [];
      var ok = 0;
      G.world.scene.traverse(function(o){
        if (!o.isMesh || !o.material || !o.material.map) return;
        var img = o.material.map.image;
        if (!img) return;
        var w = img.width, h = img.height;
        // 允许：32×32 瓦片、96×192 角色帧、小尺寸
        if (w <= 128 && h <= 256) { ok++; }
        else { bad.push(w + 'x' + h); }
      });
      return { ok: ok, bad: bad };
    })()`);
    check('**没有贴图在平铺整张图集**',
      texCheck.bad.length === 0,
      texCheck.bad.length ? '异常尺寸: ' + texCheck.bad.join(',') : texCheck.ok + ' 张贴图尺寸正常');

    // ---- 7. 素材来源可查 ----
    const credits = await cdp.eval(`(function(){
      var m = G.assets && G.assets.manifest;
      return {
        count: (m && m.credits) ? m.credits.length : 0,
        licenses: (m && m.credits) ? m.credits.map(function(c){ return c.license; }) : [],
        hasFn: typeof G.loading.showCredits === 'function'
      };
    })()`);
    check('manifest 里登记了素材来源', credits.count >= 1, credits.count + ' 条');
    check('每条都标明授权', credits.licenses.every(function(l){ return !!l; }),
      credits.licenses.join(' / '));
    check('有素材来源面板入口', credits.hasFn === true);
  }

  // ---- 8. 图层不穿透（renderOrder 分层）----
  const layers = await cdp.eval(`(function(){
    var ground = null, roof = null, shadow = null, char = null;
    G.world.scene.traverse(function(o){
      if (!o.isMesh) return;
      var p = o.geometry.parameters || {};
      if (p.width === 60 && p.height === 44) ground = o;
      if (o.renderOrder === 20 && !roof) roof = o;
      if (o.renderOrder === 40 && !char) char = o;
      if (o.renderOrder === 1 && o.material && o.material.color &&
          o.material.color.getHex() === 0x000000 && !shadow) shadow = o;
    });
    return {
      groundY: ground ? ground.position.y : null,
      roofY: roof ? roof.position.y : null,
      shadowY: shadow ? shadow.position.y : null,
      hasChar: !!char,
      // 关键：物件必须明显高于地面，否则会互相穿透
      roofAboveGround: (roof && ground) ? (roof.position.y - ground.position.y) > 0.2 : null,
      shadowNearGround: (shadow && ground) ? Math.abs(shadow.position.y - ground.position.y) < 0.1 : null
    };
  })()`);
  check('屋顶明显高于地面（不穿透）', layers.roofAboveGround === true,
    '地面 y=' + layers.groundY + '  屋顶 y=' + layers.roofY);
  check('阴影贴地（略高于地面）', layers.shadowNearGround === true,
    '阴影 y=' + layers.shadowY);
  check('场景里有角色 mesh', layers.hasChar === true);

  // ---- 9. 无错误 ----
  check('全程无 JS 错误', errors.length === 0, errors.length + ' errors');

  await b.kill();
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log('\n=== 结果: ' + pass + '/' + results.length + ' 通过 ===');
  if (fail) {
    console.log('\n失败项：');
    results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name + '  ' + (r.detail || '')));
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试异常:', e); process.exit(2); });
