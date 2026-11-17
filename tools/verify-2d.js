// tools/verify-2d.js — 2D 模式验收
//
// 【为什么需要】
// 这次是**推翻 3D 架构**做真正的 Canvas 2D 渲染。
// 之前三次失败（图层穿透 / 角色消失 / 纹理混乱）全部来自
// "3D 相机 + 像素贴图"，所以必须把新架构的关键点钉死：
//   1) 渲染确实走 Canvas 2D（没有 three.js 场景参与）
//   2) 画面有内容（不是黑屏/纯色）
//   3) 角色可见（不是消失）
//   4) 瓦片纹理正确（不是整张图集平铺）
//   5) 角色能移动、方向正确、动画在播
//   6) 碰撞生效（走不进房子/水）
//
// 【前提】需要 HTTP 服务：
//   python -m http.server 8899
//   node tools/verify-2d.js http://localhost:8899/dev.html
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

// 必须带 mode=2d，否则会走 3D 路线
function ensure2d(u) {
  if (!u) return u;
  if (u.indexOf('mode=2d') >= 0) return u;
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'mode=2d';
}
const TARGET_URL = ensure2d(process.argv[2] ||
  'http://localhost:8899/dev.html');

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 2D 模式验收 ===');
  console.log('目标地址: ' + TARGET_URL + '\n');

  const b = await launchOwnChrome({ width: 1100, height: 750 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const errors = [];
  cdp.on('Runtime.exceptionThrown', e => { errors.push(e.exceptionDetails.text || 'exception'); });

  await cdp.send('Page.navigate', { url: TARGET_URL + (TARGET_URL.indexOf('?') >= 0 ? '&' : '?') + 'v=' + Date.now() });

  let ready = false;
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    try {
      if (await cdp.eval('window.__GAME_READY__===true?1:0') === 1) { ready = true; break; }
    } catch (e) {}
  }
  check('2D 模式启动完成', ready);
  if (!ready) { await b.kill(); process.exit(1); }
  await sleep(2000);

  // ---- 1. 架构：确实走 Canvas 2D，没有 three.js 场景 ----
  const arch = await cdp.eval(`(function(){
    return {
      hasRender2d: !!G.render2d,
      hasTiles16: !!G.tiles16,
      hasWorld2d: !!G.world2d,
      hasBoot2d: !!G.boot2d,
      running: G.boot2d ? G.boot2d.running : null,
      // 3D 世界不应该被构建
      worldSceneBuilt: !!(G.world && G.world.scene),
      sheets: G.tiles16 ? Object.keys(G.tiles16.sheets).length : 0,
      tilesOk: G.tiles16 ? !!G.tiles16.ok : false
    };
  })()`);
  check('Canvas2D 渲染层已初始化', arch.hasRender2d === true);
  check('瓦片图集已加载', arch.sheets >= 10, arch.sheets + ' 张');
  check('2D 世界已构建', arch.hasWorld2d === true);
  check('主循环运行中', arch.running === true);
  check('**未构建 3D 场景**（彻底绕开 three.js）', arch.worldSceneBuilt === false);

  // ---- 2. 画面有内容（不是黑屏） ----
  const pixels = await cdp.eval(`(function(){
    var R = G.render2d;
    R.begin('#1A2418');
    G.world2d.draw();
    var img = R.ctx.getImageData(0, 0, R.VIEW_W, R.VIEW_H);
    var d = img.data;
    var colors = {};
    for (var i = 0; i < d.length; i += 4 * 131) {
      var k = d[i] + ',' + d[i+1] + ',' + d[i+2];
      colors[k] = (colors[k] || 0) + 1;
    }
    var keys = Object.keys(colors);
    return {
      uniqueColors: keys.length,
      top: keys.sort(function(a,b){ return colors[b]-colors[a]; }).slice(0, 4)
    };
  })()`);
  check('画布有实际内容（不是纯色）', pixels.uniqueColors >= 8,
    pixels.uniqueColors + ' 种颜色');

  // ---- 3. 瓦片纹理正确（不是整张图集）----
  //
  // 曾经的 bug：repeat > 1 导致整张图集被平铺。
  // 2D 用 drawImage 裁切，理论上不会发生，但要验证裁切区域确实小。
  const tileCheck = await cdp.eval(`(function(){
    var names = ['grass', 'dirt', 'roof', 'wall', 'water'];
    var out = [];
    names.forEach(function(n){
      var t = G.tiles16.get(n);
      if (!t) { out.push({ n: n, missing: true }); return; }
      out.push({
        n: n,
        srcW: t.img.width, srcH: t.img.height,
        cropW: t.sw, cropH: t.sh,
        sx: t.sx, sy: t.sy
      });
    });
    return out;
  })()`);
  const allCropped = tileCheck.every(t => !t.missing && t.cropW === 16 && t.cropH === 16);
  check('**瓦片按 16×16 精确裁切**（不会整张图集平铺）', allCropped,
    tileCheck.map(t => t.n + ':' + t.cropW + 'x' + t.cropH).join(' '));

  // ---- 4. 角色可见 ----
  const charCheck = await cdp.eval(`(function(){
    var f = G.tiles16.charFrame(0, 0);
    var img = G.tiles16.sheets.chars;
    return {
      hasFrame: !!f,
      frameW: f ? f.sw : 0,
      frameH: f ? f.sh : 0,
      sheetW: img ? img.width : 0,
      playerX: Math.round(G.world2d.player.x),
      playerY: Math.round(G.world2d.player.y),
      dir: G.world2d.player.dir,
      frame: G.world2d.player.frame
    };
  })()`);
  check('**角色帧可取到**（不会消失）', charCheck.hasFrame === true,
    charCheck.frameW + '×' + charCheck.frameH + ' 从 ' + charCheck.sheetW + 'px 图集');

  // ---- 5. 移动与朝向 ----
  async function press(code, key, vk, ms) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk });
    await sleep(ms);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
  }

  const before = await cdp.eval(`(function(){
    return { x: Math.round(G.world2d.player.x), y: Math.round(G.world2d.player.y) };
  })()`);

  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
  await sleep(500);
  const moving = await cdp.eval(`(function(){
    return {
      x: Math.round(G.world2d.player.x),
      dir: G.world2d.player.dir,
      frame: G.world2d.player.frame,
      moving: G.world2d.player.moving
    };
  })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
  await sleep(300);

  check('按 D 角色向右移动', moving.x > before.x,
    before.x + ' → ' + moving.x);
  check('朝向正确（右 = dir 3）', moving.dir === 3, 'dir=' + moving.dir);
  check('行走动画在播（frame > 0）', moving.frame > 0, 'frame=' + moving.frame);

  // ---- 6. 四方向朝向 ----
  const dirTest = [];
  for (const d of [
    { code: 'KeyW', key: 'w', vk: 87, expect: 1, name: '上' },
    { code: 'KeyS', key: 's', vk: 83, expect: 0, name: '下' },
    { code: 'KeyA', key: 'a', vk: 65, expect: 2, name: '左' }
  ]) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: d.code, key: d.key, windowsVirtualKeyCode: d.vk });
    await sleep(250);
    const dir = await cdp.eval(`G.world2d.player.dir`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: d.code, key: d.key, windowsVirtualKeyCode: d.vk });
    await sleep(120);
    dirTest.push({ name: d.name, got: dir, expect: d.expect });
  }
  check('四方向朝向正确（上=1 下=0 左=2 右=3）',
    dirTest.every(t => t.got === t.expect),
    dirTest.map(t => t.name + ':' + t.got).join(' '));

  // ---- 7. 碰撞 ----
  const collide = await cdp.eval(`(function(){
    var W = G.world2d;
    // 房子墙的中心
    var m = W.map;
    var solidCell = null;
    for (var i = 0; i < m.solid.length; i++) {
      if (m.solid[i]) { solidCell = i; break; }
    }
    if (solidCell === null) return { err: 'no solid' };
    var c = solidCell % m.cols, r = Math.floor(solidCell / m.cols);
    var wx = c * W.TILE + W.TILE / 2;
    var wy = r * W.TILE + W.TILE / 2;
    // 草地中心（可走）
    var gx = 5 * W.TILE, gy = 5 * W.TILE;
    return {
      solidBlocked: W.isSolidAt(wx, wy),
      grassWalkable: !W.isSolidAt(gx, gy),
      solidTile: [c, r],
      groundName: m.ground[solidCell]
    };
  })()`);
  check('碰撞：实心格不可通行', collide.solidBlocked === true,
    '(' + collide.solidTile + ') ' + collide.groundName);
  check('碰撞：草地可通行', collide.grassWalkable === true);

  // ---- 8. 相机跟随 ----
  const cam = await cdp.eval(`(function(){
    var R = G.render2d, p = G.world2d.player;
    return {
      camX: Math.round(R.cam.x), camY: Math.round(R.cam.y),
      playerX: Math.round(p.x), playerY: Math.round(p.y),
      viewW: R.VIEW_W, viewH: R.VIEW_H,
      // 相机中心应该接近玩家
      centered: Math.abs((R.cam.x + R.VIEW_W/2) - p.x) < 60 &&
                Math.abs((R.cam.y + R.VIEW_H/2) - p.y) < 60
    };
  })()`);
  check('相机中心跟随玩家', cam.centered === true,
    'cam+半屏=(' + Math.round(cam.camX + cam.viewW/2) + ',' +
    Math.round(cam.camY + cam.viewH/2) + ')  玩家=(' + cam.playerX + ',' + cam.playerY + ')');

  // ---- 9. NPC ----
  const npcs = await cdp.eval(`(function(){
    return {
      count: G.world2d.npcs.length,
      names: G.world2d.npcs.map(function(n){ return n.name; })
    };
  })()`);
  check('NPC 已放置', npcs.count >= 4, npcs.names.join(' '));

  // ---- 10. UI 层可见且已填充 ----
  //
  // 【为什么必须断言这个】
  // 第一版在 boot2d 里写了 `ui.style.display='none'`，
  // 把整个 HUD 关掉了 —— 用户进游戏看到"只有地图，没有血条、技能栏"。
  // 这是把 UI 当成"启动遮罩"误伤的结果，必须钉死。
  const ui = await cdp.eval(`(function(){
    var el = document.getElementById('ui');
    return {
      exists: !!el,
      display: el ? getComputedStyle(el).display : null,
      children: el ? el.children.length : 0,
      uiRoot: !!(G.ui && G.ui.root),
      hpText: (G.ui && G.ui.hpText) ? G.ui.hpText.textContent : null,
      hpWidth: (G.ui && G.ui.hpFill) ? G.ui.hpFill.style.width : null
    };
  })()`);
  check('**UI 层可见**（不是被隐藏）', ui.exists && ui.display !== 'none',
    'display=' + ui.display + ' children=' + ui.children);
  check('HUD 已初始化并显示数值', ui.uiRoot === true && !!ui.hpText,
    'HP: ' + ui.hpText + '  width=' + ui.hpWidth);

  // ---- 11. 角色外观（不是光头裸模）----
  const skin = await cdp.eval(`(function(){
    return {
      hasSkin: !!G.charSkin,
      looks: G.charSkin ? Object.keys(G.charSkin.LOOKS) : [],
      cached: G.charSkin ? Object.keys(G.charSkin._cache) : [],
      playerLook: G.world2d.player.look,
      npcLooks: G.world2d.npcs.map(function(n){ return n.look; })
    };
  })()`);
  check('**角色有外观图层**（不是光头裸模）',
    skin.hasSkin && skin.cached.length >= 5,
    skin.cached.join(','));
  check('玩家与 NPC 都分配了外观',
    !!skin.playerLook && skin.npcLooks.every(function (l) { return !!l; }),
    'player=' + skin.playerLook + '  npc=' + skin.npcLooks.join(','));

  // ---- 12. 合成后的头部确实是头发色 ----
  //
  // 判据：原图头部是肤色（R>200），合成后应该是深色头发（R<120）。
  // 直接采样像素比较，不靠"看起来像"。
  const skinPixels = await cdp.eval(`(function(){
    var s = G.charSkin.sheetFor('player');
    if (!s) return null;
    var g = s.canvas.getContext('2d');
    var hairPx = g.getImageData(14, 15, 4, 1).data;
    return {
      hairRGB: [hairPx[0], hairPx[1], hairPx[2]],
      sheetW: s.canvas.width,
      sheetH: s.canvas.height
    };
  })()`);
  const isDarkHair = skinPixels &&
    skinPixels.hairRGB[0] < 120 &&
    skinPixels.hairRGB[1] < 120 &&
    skinPixels.hairRGB[2] < 120;
  check('**合成后头部是头发色**（不是原图肤色）', isDarkHair,
    'RGB=' + (skinPixels ? skinPixels.hairRGB.join(',') : 'null'));
  check('四向图集尺寸正确（224×256）',
    skinPixels && skinPixels.sheetW === 224 && skinPixels.sheetH === 256,
    skinPixels ? skinPixels.sheetW + '×' + skinPixels.sheetH : 'null');

  // ---- 13. 无错误 ----
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
