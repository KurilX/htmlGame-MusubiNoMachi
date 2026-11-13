// tools/verify-build.js — 验证构建产物 game.html 能在 file:// 下真实运行
//
// 与 verify-d1.js 的区别：那个测 dev.html（多文件），这个测 game.html（单文件）。
// 单文件必须独立通过，否则"双击就能玩"这个承诺是空的。
const fs = require('fs');
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'game.html');

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  if (!fs.existsSync(GAME)) {
    console.error('game.html 不存在，请先运行 node build.mjs');
    process.exit(2);
  }

  console.log('=== 单文件构建验证（game.html via file://）===\n');

  const stat = fs.statSync(GAME);
  check('game.html 存在且体积合理', stat.size > 500 * 1024 && stat.size < 8 * 1024 * 1024,
    (stat.size / 1024 / 1024).toFixed(2) + ' MB');

  // 静态检查：文件里不该有任何外部资源引用
  const src = fs.readFileSync(GAME, 'utf8');
  check('无外部 <script src>', !/<script\s+src=/i.test(src));
  check('无 http(s) 资源引用', !/(?:src|href)="https?:\/\//i.test(src));
  check('无外部样式表', !/<link[^>]+href="(?!data:)/i.test(src));

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  const errors = [];
  cdp.on('Runtime.exceptionThrown', p => {
    const d = p.exceptionDetails;
    errors.push(((d.exception && d.exception.description) || d.text));
  });
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errors.push(p.args.map(a => a.value || a.description || '').join(' '));
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  try {
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  } catch (e) {}

  // 直接打开构建产物（无 cacheBust 也要能跑，因为它是独立文件）
  const url = 'file:///' + GAME.replace(/\\/g, '/');
  console.log('打开 ' + url + '\n');
  await cdp.send('Page.navigate', { url });
  await sleep(4500);

  // ---- 启动 ----
  const boot = await cdp.eval(`(function(){
    return {
      ready: !!window.__GAME_READY__,
      hasG: typeof window.G === 'object',
      hasThree: typeof window.THREE === 'object',
      rev: window.THREE ? window.THREE.REVISION : null,
      errs: (window.__ERRORS__ || []).slice(),
      canvasW: G && G.pixels && G.pixels.renderer ? G.pixels.renderer.domElement.style.width : '',
      bootHidden: document.getElementById('boot') ? document.getElementById('boot').style.display : 'missing'
    };
  })()`);

  check('THREE 已内联并可执行', boot.hasThree === true && boot.rev === '160', 'r' + boot.rev);
  check('游戏命名空间存在', boot.hasG === true);
  check('游戏启动完成', boot.ready === true);
  check('加载层已隐藏', boot.bootHidden === 'none', boot.bootHidden);
  check('画布已渲染尺寸', parseFloat(boot.canvasW) > 500, boot.canvasW);
  check('启动无 JS 错误', boot.errs.length === 0 && errors.length === 0,
    boot.errs.concat(errors).slice(0, 2).join(' | ') || 'clean');

  // ---- 世界与玩法 ----
  const world = await cdp.eval(`(function(){
    return {
      props: G.world.props.length,
      inter: G.world.interactables.length,
      npcs: G.world.npcs.length,
      zones: G.world.spawnZones.length,
      groundMeshes: G.world.ground ? G.world.ground.length : 0,
      hasTerrain: !!G.terrain,
      hasVegetation: !!(G.world.vegetation && G.world.vegetation.tufts)
    };
  })()`);
  check('世界物件已构建', world.props > 50, world.props + ' props');
  check('地形系统已加载', world.hasTerrain === true);
  check('地形网格已生成', world.groundMeshes >= 2, world.groundMeshes + ' mesh');
  check('植被已生成', world.hasVegetation === true);
  // 同上：不写死数量，随地区扩展增长
  check('NPC 已生成', world.npcs >= 4, world.npcs);

  // ---- 真实交互 ----
  const before = await cdp.eval(`({x: G.player.state.x, z: G.player.state.z})`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await sleep(700);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await sleep(200);
  const after = await cdp.eval(`({x: G.player.state.x, z: G.player.state.z})`);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check('能移动（单文件内键盘事件）', moved > 1.0, 'delta=' + moved.toFixed(2));

  // 推帧确保主循环在工作
  await cdp.eval(`for(var i=0;i<120;i++) G.tickOnce(1/60);`);
  const afterTick = await cdp.eval(`({enemies: G.enemy.list.length, elapsed: G.main.elapsed.toFixed(1)})`);
  check('主循环可推进', parseFloat(afterTick.elapsed) > 1.5, 'elapsed=' + afterTick.elapsed + 's');
  check('怪物能刷新', afterTick.enemies > 0, afterTick.enemies + ' enemies');

  // 战斗
  const combat = await cdp.eval(`(function(){
    var st = G.player.state;
    var e = G.enemy.list[0];
    if (!e) return null;
    st.x = e.x - 1.5; st.z = e.z; st.attackCd = 0; st.moveLock = 0;
    var hpBefore = e.hp;
    var dealt = G.combat.cone({
      x: st.x, z: st.z,
      angle: Math.atan2(e.x - st.x, e.z - st.z),
      arc: Math.PI * 0.75, radius: 2.5,
      damage: 30, crit: false, source: 'player', knockback: 2
    });
    return { hpBefore: hpBefore, hpAfter: e.hp, dealt: dealt };
  })()`);
  check('战斗伤害结算正常', combat && combat.hpAfter < combat.hpBefore,
    combat ? `${combat.hpBefore} -> ${combat.hpAfter}` : 'no enemy');

  // 存档（单文件下 localStorage 是否可用）
  const save = await cdp.eval(`(function(){
    try {
      var ok = G.save.save(1);
      var loaded = G.save.load(1);
      return { ok: ok, loaded: !!loaded, lv: loaded && loaded.player.level };
    } catch (e) { return { ok: false, err: e.message }; }
  })()`);
  check('localStorage 存档可用', save.ok && save.loaded, 'Lv.' + save.lv);

  // 最终错误
  const finalErrs = await cdp.eval(`(window.__ERRORS__ || []).length`);
  check('全程无累积错误', finalErrs === 0 && errors.length === 0,
    (finalErrs + errors.length) + ' errors');
  if (errors.length) {
    errors.slice(0, 3).forEach(e => console.log('    ' + String(e).split('\n')[0]));
  }

  // 截图
  await cdp.eval(`(function(){
    G.player.state.x = 0; G.player.state.z = 30;
    G.camera.follow.x = 0; G.camera.follow.z = 30;
    G.camera.update(0.016, {x:0, z:30, y: G.world.groundY(0,30) + 0.6});
    G.world.timeOfDay = 0.4;
    for (var i=0;i<5;i++) G.tickOnce(1/60);
  })()`);
  await sleep(500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const shotPath = path.join(ROOT, 'tools', 'build-verify.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log('\n截图: ' + shotPath);

  await b.kill();

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log('\n=== 结果: ' + pass + '/' + results.length + ' 通过 ===');
  if (fail) {
    console.log('\n失败项：');
    results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name + '  ' + (r.detail || '')));
  } else {
    console.log('单文件 game.html 可在 file:// 下双击运行 — 交付承诺成立');
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('验证脚本异常:', e); process.exit(2); });
