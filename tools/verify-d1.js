// tools/verify-d1.js — D1 闸口验收：模拟真实输入，验证可玩性
//
// 【铁律一】端口一律由 tools/cdp.js 动态申请 + 归属校验，绝不写死。
//   Amlcowork 桌面客户端会监听 9333，写死端口曾把测试页 navigate 进用户窗口。
// 【铁律二】headless 下 requestAnimationFrame 会被节流（几乎不跑），
//   所以每个"按下按键后应当生效"的检查都必须调用 pumpFrames() 手动推帧，
//   否则测的是"rAF 有没有跑"而不是"游戏逻辑对不对"。
const fs = require('fs');
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '..');

/**
 * 手动推进游戏若干帧（绕过 rAF 节流）。
 * 固定步长 1/60，用 G.tickOnce。
 */
async function pumpFrames(cdp, frames) {
  frames = frames || 1;
  await cdp.eval(`(function(){
    for (var i = 0; i < ${frames}; i++) { if (G.tickOnce) G.tickOnce(1/60); }
  })()`);
}

/** 推进指定的模拟秒数 */
async function pumpSeconds(cdp, sec) {
  await pumpFrames(cdp, Math.max(1, Math.round(sec * 60)));
}

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== D1 闸口验收 ===\n');
  console.log('申请空闲端口并拉起独立 Chrome…');

  const browser = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = browser.cdp;
  console.log('已连接：端口 ' + browser.port + '，profile ' + browser.tag + '\n');

  const consoleErrors = [];
  cdp.on('Runtime.exceptionThrown', p => {
    const d = p.exceptionDetails;
    consoleErrors.push(((d.exception && d.exception.description) || d.text));
  });
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') {
      consoleErrors.push(p.args.map(a => a.value || a.description || '').join(' '));
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  try {
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  } catch (e) { /* 忽略 */ }

  try {
    await run(cdp, check, results);
  } finally {
    await browser.kill();
  }

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log('\n=== 结果: ' + pass + '/' + results.length + ' 通过 ===');
  if (fail > 0) {
    console.log('\n失败项：');
    results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name + '  ' + (r.detail || '')));
  }
  process.exit(fail > 0 ? 1 : 0);
}

async function run(cdp, check, results) {
  const consoleErrors = [];
  cdp.on('Runtime.exceptionThrown', p => {
    const d = p.exceptionDetails;
    consoleErrors.push(((d.exception && d.exception.description) || d.text));
  });
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') {
      consoleErrors.push(p.args.map(a => a.value || a.description || '').join(' '));
    }
  });

  // ---- 打开游戏（带 cacheBust 防 file:// 缓存）----
  const cacheBust = '?v=' + Date.now();
  const url = 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + cacheBust;
  console.log('打开 ' + url + '\n');
  await cdp.send('Page.navigate', { url });
  await sleep(4000);

  // ---- 1. 启动 ----
  const bootState = await cdp.eval(`(function(){
    return {
      ready: !!window.__GAME_READY__,
      errs: (window.__ERRORS__||[]).slice(),
      canvasW: G.pixels.renderer.domElement.style.width,
      scale: G.pixels.scale,
      viewH: G.camera.viewH
    };
  })()`);
  check('游戏启动完成（__GAME_READY__）', bootState.ready === true);
  check('启动期无 JS 错误', bootState.errs.length === 0 && consoleErrors.length === 0,
    (bootState.errs.concat(consoleErrors).slice(0, 2).join(' | ')) || 'clean');
  check('画布已铺满窗口', parseFloat(bootState.canvasW) > 800, bootState.canvasW);

  // ---- 2. 世界内容 ----
  const world = await cdp.eval(`(function(){
    return {
      props: G.world.props.length,
      inter: G.world.interactables.length,
      npcs: G.world.npcs.length,
      zones: G.world.spawnZones.length
    };
  })()`);
  check('静态物件已构建', world.props > 50, world.props + ' props');
  check('可交互物已注册', world.inter > 20, world.inter + ' interactables');
  check('NPC 已生成', world.npcs === 4, world.npcs + ' NPC');

  // ---- 3. 真实键盘走路 ----
  // 注意：按住 W 期间要持续推帧，headless 下 rAF 不会自己跑
  const before = await cdp.eval(`({x: G.player.state.x, z: G.player.state.z})`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  for (let i = 0; i < 10; i++) {
    await pumpFrames(cdp, 6);   // 共 60 帧 = 1 秒游戏时间
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await pumpFrames(cdp, 2);
  const after = await cdp.eval(`({x: G.player.state.x, z: G.player.state.z})`);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check('按住 W 能移动（真实键盘事件）', moved > 1.5,
    'delta=' + moved.toFixed(2));

  // ---- 4. 走路动画 ----
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
  await pumpFrames(cdp, 12);
  const animPhase = await cdp.eval(`G.player.anim.phase`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
  check('移动时播放走路动画', animPhase === 'walk', 'phase=' + animPhase);

  // ---- 5. 刷怪（推帧直到真有怪）----
  let enemyCount = 0;
  for (let i = 0; i < 30; i++) {
    await pumpSeconds(cdp, 0.5);
    enemyCount = await cdp.eval(`G.enemy.list.length`);
    if (enemyCount > 0) break;
  }
  check('野外持续刷怪', enemyCount > 0, enemyCount + ' enemies');

  // ---- 6. 真实鼠标攻击（点怪物脚下所在屏幕位置）----
  //
  // 关键：必须用 y=0（脚下）投影到屏幕再点回地面。
  // 踩过：用 y=1.2（胸口高度）投影，屏幕点反投回 y=0 平面时
  // 存在 35° 俯角视差，地面点会偏离怪物 1.3 单位，导致朝向差 72°、打不中。
  // 这是测试写法问题，不是游戏 bug。
  const combatBefore = await cdp.eval(`(function(){
    var st = G.player.state;
    var e = G.enemy.list[0];
    if (!e) return null;
    st.x = e.x - 1.6;
    st.z = e.z;
    st.attackCd = 0;
    st.moveLock = 0;
    st.facing = Math.atan2(e.x - st.x, e.z - st.z);
    G.camera.follow.x = st.x;
    G.camera.follow.z = st.z;
    G.camera.update(0.016, { x: st.x, z: st.z, y: 0.6 });
    // y=0：脚下，反投影回地面才不会有视差
    var p = G.camera.worldToScreen(e.x, 0, e.z);
    return { id: e.id, hp: e.hp, sx: p.x, sy: p.y };
  })()`);

  if (combatBefore) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: combatBefore.sx, y: combatBefore.sy, button: 'none'
    });
    await pumpFrames(cdp, 1);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: combatBefore.sx, y: combatBefore.sy,
      button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse'
    });
    // 按下后推几帧让 basicAttack 真正执行
    await pumpFrames(cdp, 4);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: combatBefore.sx, y: combatBefore.sy,
      button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse'
    });
    await pumpFrames(cdp, 6);
    const combatAfter = await cdp.eval(`(function(){
      var e = G.enemy.list.find(function(x){return x.id === ${combatBefore.id};});
      return e ? { hp: e.hp, dead: e.dead } : { hp: -1, dead: true };
    })()`);
    check('鼠标点击能造成伤害', combatAfter.hp < combatBefore.hp || combatAfter.dead,
      combatBefore.hp + ' -> ' + combatAfter.hp);
  } else {
    check('鼠标点击能造成伤害', false, 'no enemy to test');
  }

  // ---- 7. 技能 ----
  await cdp.eval(`G.player.state.moveLock = 0;`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Digit2', key: '2', windowsVirtualKeyCode: 50 });
  await pumpFrames(cdp, 3);
  const afterSkill = await cdp.eval(`G.player.state.skills[2] ? G.player.state.skills[2].cd : -1`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Digit2', key: '2', windowsVirtualKeyCode: 50 });
  check('技能可施放并进入冷却', afterSkill > 0, 'cd=' + (afterSkill || 0).toFixed(1));

  // ---- 8. 闪避 ----
  //
  // 这里是本次验收最费劲的一处，原因值得记下来：
  //   headless 下 rAF 并非完全停止，只是被节流。按键会在
  //   CDP 往返期间就被真实 rAF 主循环消费并执行完毕，
  //   所以"先按键再推帧再读 cd"会读到已被推进/被自己归零覆盖的值。
  // 正确做法：挂一个一次性探针（monkey-patch P.dodge），
  //   它只要被调用过就说明闪避真的触发了。
  await cdp.eval(`(function(){
    window.__dodgeCalled = false;
    if (!G.player.__rawDodge) {
      G.player.__rawDodge = G.player.dodge;
      G.player.dodge = function () {
        window.__dodgeCalled = true;
        return G.player.__rawDodge.apply(this, arguments);
      };
    }
    window.__dodgeCalled = false;
    G.player.state.dodge.cd = 0;
    G.player.state.dodge.timer = 0;
  })()`);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', code: 'ShiftLeft', key: 'Shift',
    windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 8
  });
  // 等真实 rAF 跑（不要自己推帧，否则会和它抢）
  await sleep(300);
  const dodgeResult = await cdp.eval(`({
    called: window.__dodgeCalled,
    timer: G.player.state.dodge.timer,
    cd: G.player.state.dodge.cd,
    dead: G.player.state.dead,
    keysDodge: !!G.input.keys.dodge,
    enabled: G.input.enabled,
    hasRaw: !!G.player.__rawDodge,
    sameFn: G.player.dodge === G.player.__rawDodge
  })`);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', code: 'ShiftLeft', key: 'Shift',
    windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 0
  });
  check('闪避能被触发', dodgeResult.called === true,
    'called=' + dodgeResult.called + ' cd=' + (dodgeResult.cd || 0).toFixed(2) +
    ' keys=' + dodgeResult.keysDodge + ' dead=' + dodgeResult.dead +
    ' patchOK=' + (dodgeResult.hasRaw && !dodgeResult.sameFn));

  // ---- 9. 升级 ----
  await cdp.eval(`G.player.gainExp(200)`);
  await sleep(200);
  const lvl = await cdp.eval(`G.player.state.level`);
  check('经验足够能升级', lvl > 1, 'Lv.' + lvl);

  // ---- 10. 掉落拾取 ----
  const lootTest = await cdp.eval(`(function(){
    var st = G.player.state;
    G.loot.spawnDrop('gold', st.x, st.z, { amount: 99 });
    return { goldBefore: st.gold };
  })()`);
  await cdp.eval(`G.tickOnce(0.05)`);
  await sleep(250);
  const goldAfter = await cdp.eval(`G.player.state.gold`);
  check('金币掉落能被自动拾取', goldAfter > lootTest.goldBefore,
    lootTest.goldBefore + ' -> ' + goldAfter);

  // ---- 11. 交互（碑文）----
  const interTest = await cdp.eval(`(function(){
    var st = G.player.state;
    var stele = G.world.interactables.find(function(i){ return i.kind === 'stele'; });
    if (!stele) return null;
    st.x = stele.x; st.z = stele.z - 1;
    return { ok: true };
  })()`);
  if (interTest) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 });
    await sleep(100);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 });
    await sleep(400);
    const toastCount = await cdp.eval(`document.querySelectorAll('#ui .toast').length`);
    check('按 E 能读碑文（toast 出现）', toastCount > 0, toastCount + ' toasts');
  }

  // ---- 12. 对话 ----
  await cdp.eval(`(function(){
    var npc = G.world.npcs[0];
    G.player.state.x = npc.x; G.player.state.z = npc.z + 1.2;
  })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 });
  await sleep(100);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 });
  await sleep(500);
  const dlgVisible = await cdp.eval(`(function(){
    return { on: G.dlg.active, visible: G.ui.dialogEl.style.display !== 'none',
             name: G.ui.dialogName.textContent, text: G.ui.dialogText.textContent.slice(0,20) };
  })()`);
  check('能打开 NPC 对话', dlgVisible.on === true && dlgVisible.visible,
    dlgVisible.name + ': ' + dlgVisible.text);
  await cdp.eval(`G.dlg.close()`);

  // ---- 13. 背包 ----
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyI', key: 'i', windowsVirtualKeyCode: 73 });
  await sleep(80);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyI', key: 'i', windowsVirtualKeyCode: 73 });
  await sleep(400);
  const invOpen = await cdp.eval(`G.ui.panels.inventory.style.display !== 'none'`);
  check('按 I 打开背包面板', invOpen === true);

  // ---- 14. 存档往返 ----
  const saveTest = await cdp.eval(`(function(){
    var ok = G.save.save(3);
    var loaded = G.save.load(3);
    return { ok: ok, loaded: !!loaded, lv: loaded && loaded.player.level,
             bag: loaded ? loaded.player.bag.length : -1 };
  })()`);
  check('存档写入并读回', saveTest.ok && saveTest.loaded && saveTest.lv >= 1,
    'Lv.' + saveTest.lv + ' bag=' + saveTest.bag);

  // ---- 15. 无累积错误 ----
  const finalErrs = await cdp.eval(`(window.__ERRORS__||[]).length`);
  check('全程无 JS 错误', finalErrs === 0 && consoleErrors.length === 0,
    (finalErrs + consoleErrors.length) + ' errors');
  if (consoleErrors.length) {
    console.log('  错误明细：');
    consoleErrors.slice(0, 4).forEach(e => console.log('    ' + String(e).split('\n')[0]));
  }

  // ---- 16. 截图 ----
  await cdp.eval(`try{G.dlg.close(); G.ui.closeAllPanels();}catch(e){}`);
  await sleep(600);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const shotPath = path.join(ROOT, 'tools', 'd1-verify.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log('\n截图: ' + shotPath);
}

main().catch(e => {
  console.error('验收脚本异常:', e);
  process.exit(2);
});
