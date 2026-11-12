// tools/verify-online.js — 验证线上 (GitHub Pages) 版本真实可玩
//
// 与 verify-build.js 的区别：那个测本地 file://，这个测 https:// 线上地址。
// 线上和本地有几个关键差异必须验证：
//   1) https 下 localStorage / AudioContext 的可用性与 file:// 不同
//   2) 资源可能 404（虽然单文件理论上不该有外部请求）
//   3) 必须确认加载的是"线上那份"，而不是浏览器缓存
//
// 【踩过的坑：不要用 res.Content.Length 比对文件大小】
// 曾经用 PowerShell 的 Invoke-WebRequest 取线上 game.html，
// 读到 958959 字节，而本地是 984554，差 25KB，误判成"线上文件被改过"。
// 实际原因：Invoke-WebRequest 把 HTML 当字符串解码（多字节 UTF-8 + 换行规范化），
// .Content.Length 是**字符数不是字节数**。
// 正确做法：读 Content-Length 响应头，或用 curl --compressed 落盘后 stat 字节数。
const path = require('path');
const fs = require('fs');
const { launchOwnChrome, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '..');
const URL = process.argv[2] || 'https://kurilx.github.io/htmlGame-MusubiNoMachi/game.html';

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 线上版本验证 ===');
  console.log('地址: ' + URL + '\n');

  // ---- 0. 线上文件完整性（HTTP 层，先于浏览器） ----
  //
  // 用 HEAD 拿 Content-Length 与本地 game.html 比对。
  // 注意：必须用 Content-Length 响应头，不能用 Invoke-WebRequest 的
  // .Content.Length（那是解码后的字符数，会差几万）。
  try {
    const localSize = fs.statSync(path.join(ROOT, 'game.html')).size;
    const http = require('http');
    const https = require('https');
    // 注意：用 require('url').URL，不要直接用全局 URL
    // （踩过：URL is not a constructor，因为全局 URL 在某些上下文被覆盖）
    const { URL: NodeURL } = require('url');
    const urlObj = new NodeURL(URL);
    const client = urlObj.protocol === 'https:' ? https : http;
    const remoteSize = await new Promise((resolve, reject) => {
      const req = client.request({
        host: urlObj.host, path: urlObj.pathname, method: 'HEAD'
      }, res => {
        res.resume();
        resolve(parseInt(res.headers['content-length'], 10));
      });
      req.on('error', reject);
      req.setTimeout(20000, () => req.destroy(new Error('timeout')));
      req.end();
    });
    check('线上文件的字节数与本地一致', remoteSize === localSize,
      'remote=' + remoteSize + ' local=' + localSize);
  } catch (e) {
    check('线上文件的字节数与本地一致', false, 'HEAD 失败: ' + e.message);
  }

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  const errors = [];
  const netFails = [];

  cdp.on('Runtime.exceptionThrown', p => {
    const d = p.exceptionDetails;
    errors.push(((d.exception && d.exception.description) || d.text));
  });
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errors.push(p.args.map(a => a.value || a.description || '').join(' '));
  });
  // 记录所有加载失败的请求（线上版本最常见的问题是资源 404）
  cdp.on('Network.loadingFailed', p => {
    netFails.push(p.errorText + ' ' + (p.type || ''));
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  try {
    await cdp.send('Network.enable');
    // 注意：这里**不能**禁用缓存，否则测不到真实用户首次访问的体验
  } catch (e) {}

  await cdp.send('Page.navigate', { url: URL });
  await sleep(6000);

  // ---- 1. 页面来源确认（必须真的是线上） ----
  const origin = await cdp.eval(`({
    href: location.href,
    protocol: location.protocol,
    isHttps: location.protocol === 'https:',
    title: document.title
  })`);
  check('通过 https 加载', origin.isHttps === true, origin.protocol + ' // ' + origin.href);
  check('页面标题正确', /結|Musubi/i.test(origin.title || ''), origin.title);

  // ---- 2. 游戏启动 ----
  const boot = await cdp.eval(`(function(){
    return {
      ready: !!window.__GAME_READY__,
      hasThree: typeof window.THREE === 'object',
      rev: window.THREE ? window.THREE.REVISION : null,
      hasG: typeof window.G === 'object',
      errs: (window.__ERRORS__ || []).slice(),
      bootHidden: document.getElementById('boot') ? document.getElementById('boot').style.display : 'n/a',
      canvasW: (G && G.pixels && G.pixels.renderer) ? G.pixels.renderer.domElement.style.width : ''
    };
  })()`);
  check('THREE 已内联并执行', boot.hasThree && boot.rev === '160', 'r' + boot.rev);
  check('游戏启动完成', boot.ready === true);
  check('加载层已隐藏', boot.bootHidden === 'none', boot.bootHidden);
  check('画布已渲染', parseFloat(boot.canvasW) > 500, boot.canvasW);
  check('启动无 JS 错误', boot.errs.length === 0 && errors.length === 0,
    (boot.errs.concat(errors).slice(0, 2).join(' | ')) || 'clean');

  // ---- 3. 资源全部加载成功（单文件的另一个验证角度） ----
  check('无网络请求失败', netFails.length === 0, netFails.slice(0, 3).join(' | ') || '0 failures');

  // ---- 4. 世界内容 ----
  const world = await cdp.eval(`(function(){
    return {
      props: G.world.props.length,
      inter: G.world.interactables.length,
      npcs: G.world.npcs.length,
      terrain: !!G.terrain,
      vegetation: !!(G.world.vegetation && G.world.vegetation.tufts),
      resolution: G.INTERNAL_W + 'x' + G.INTERNAL_H
    };
  })()`);
  check('世界已构建', world.props > 90, world.props + ' props');
  check('地形与植被存在', world.terrain && world.vegetation);
  check('内部分辨率为 1152x648', world.resolution === '1152x648', world.resolution);
  check('NPC 已生成', world.npcs === 4, world.npcs);

  // ---- 5. 真实输入（键盘 + 鼠标） ----
  const before = await cdp.eval(`({x: G.player.state.x, z: G.player.state.z})`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await sleep(800);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await sleep(150);
  const after = await cdp.eval(`({x: G.player.state.x, z: G.player.state.z})`);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check('https 下键盘可操作', moved > 1.0, 'delta=' + moved.toFixed(2));

  // ---- 6. localStorage（https 下与 file:// 行为不同，必须单独验证） ----
  const save = await cdp.eval(`(function(){
    try {
      var ok = G.save.save(1);
      var loaded = G.save.load(1);
      return { ok: ok, loaded: !!loaded, lv: loaded && loaded.player.level };
    } catch (e) { return { ok: false, err: e.message }; }
  })()`);
  check('https 下存档可用', save.ok && save.loaded, 'Lv.' + save.lv + (save.err ? ' ERR:' + save.err : ''));

  // ---- 7. AudioContext（https 下受自动播放策略限制） ----
  const audio = await cdp.eval(`(function(){
    if (!G.audio) return { exists: false };
    return {
      exists: true,
      ctxState: G.audio.ctx ? G.audio.ctx.state : 'null',
      hasBgm: !!G.audio.startBGM
    };
  })()`);
  check('音频系统已就绪', audio.exists === true,
    'ctx=' + audio.ctxState + ' (suspended 属正常，首次交互后恢复)');

  // ---- 8. 战斗可用 ----
  await cdp.eval(`for (var i = 0; i < 120; i++) G.tickOnce(1/60);`);
  const enemyCount = await cdp.eval(`G.enemy.list.length`);
  check('刷怪正常', enemyCount > 0, enemyCount + ' enemies');

  const combat = await cdp.eval(`(function(){
    var st = G.player.state;
    var e = G.enemy.list[0];
    if (!e) return null;
    st.x = e.x - 1.5; st.z = e.z; st.attackCd = 0; st.moveLock = 0;
    var before = e.hp;
    G.combat.cone({
      x: st.x, z: st.z,
      angle: Math.atan2(e.x - st.x, e.z - st.z),
      arc: Math.PI * 0.75, radius: 2.5,
      damage: 30, crit: false, source: 'player'
    });
    return { before: before, after: e.hp };
  })()`);
  check('战斗结算正常', combat && combat.after < combat.before,
    combat ? combat.before + ' -> ' + combat.after : 'no enemy');

  // ---- 9. 全程无错误 ----
  const finalErrs = await cdp.eval(`(window.__ERRORS__ || []).length`);
  check('全程无累积错误', finalErrs === 0 && errors.length === 0,
    (finalErrs + errors.length) + ' errors');
  if (errors.length) {
    errors.slice(0, 3).forEach(e => console.log('    ' + String(e).split('\n')[0]));
  }

  // ---- 截图留档 ----
  await cdp.eval(`(function(){
    G.player.state.x = 0; G.player.state.z = 26;
    G.camera.follow.x = 0; G.camera.follow.z = 26;
    G.camera.viewH = 20;
    G.camera.resize(16/9);
    G.camera.update(0.016, {x:0, z:26, y: G.world.groundY(0,26) + 0.6});
    G.world.timeOfDay = 0.4;
    for (var i = 0; i < 5; i++) G.tickOnce(1/60);
  })()`);
  await sleep(600);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(ROOT, 'tools', 'verify-online.png');
  fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
  console.log('\n截图: ' + p);

  await b.kill();

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log('\n=== 结果: ' + pass + '/' + results.length + ' 通过 ===');
  if (fail) {
    console.log('\n失败项：');
    results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name + '  ' + (r.detail || '')));
  } else {
    console.log('线上版本可正常游玩: ' + URL);
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('验证异常:', e); process.exit(2); });
