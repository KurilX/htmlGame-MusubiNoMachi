// tools/_diag-combat.js — 定位"鼠标点击打不中"与"闪避不触发"
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '..');

(async () => {
  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  console.log('端口 ' + b.port + '（动态申请，不与 Amlcowork 冲突）\n');

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const url = 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now();
  await cdp.send('Page.navigate', { url });
  await sleep(4000);

  // ---------- A. 鼠标点击 ----------
  console.log('=== A. 鼠标攻击诊断 ===');
  const setup = await cdp.eval(`(function(){
    var st = G.player.state;
    var e = G.enemy.list[0];
    if (!e) return {err:'no enemy'};
    st.x = e.x - 1.6; st.z = e.z;
    G.camera.follow.x = st.x; G.camera.follow.z = st.z;
    G.camera.update(0.016, {x: st.x, z: st.z, y: 0.6});
    var p = G.camera.worldToScreen(e.x, 1.2, e.z);
    // 同时算一下：如果点在这个屏幕位置，射线打到地面的哪个点
    var g = G.camera.screenToGround(p.x, p.y);
    return {
      enemyId: e.id, enemyX: e.x, enemyZ: e.z,
      screenX: p.x, screenY: p.y,
      groundX: g.x, groundZ: g.z,
      distGroundToEnemy: Math.hypot(g.x - e.x, g.z - e.z).toFixed(2),
      playerX: st.x, playerZ: st.z
    };
  })()`);
  console.log(JSON.stringify(setup, null, 2));

  // 直接注入 input.mouse 值，看 basicAttack 能否打中
  const direct = await cdp.eval(`(function(){
    var st = G.player.state;
    var e = G.enemy.list.find(function(x){return x.id === ${setup.enemyId};});
    if (!e) return {err:'enemy gone'};
    var hpBefore = e.hp;
    // 绕过输入层，直接调 basicAttack
    G.input.mouse.x = ${Math.round(setup.screenX)};
    G.input.mouse.y = ${Math.round(setup.screenY)};
    G.player.basicAttack(G.input, G.camera);
    return {
      hpBefore: hpBefore, hpAfter: e.hp,
      facing: st.facing.toFixed(2),
      enemyAngle: Math.atan2(e.x - st.x, e.z - st.z).toFixed(2),
      dist: Math.hypot(e.x - st.x, e.z - st.z).toFixed(2)
    };
  })()`);
  console.log('直接调 basicAttack: ' + JSON.stringify(direct));

  // 再用真实 CDP 鼠标事件
  const before = await cdp.eval(`(function(){
    var e = G.enemy.list[0];
    return e ? {id: e.id, hp: e.hp} : null;
  })()`);
  if (before) {
    const pos = await cdp.eval(`(function(){
      var e = G.enemy.list[0];
      G.player.state.attackCd = 0;
      G.player.state.moveLock = 0;
      var p = G.camera.worldToScreen(e.x, 1.2, e.z);
      return {x: p.x, y: p.y};
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none' });
    await sleep(50);
    const mouseState = await cdp.eval(`({mx: G.input.mouse.x, my: G.input.mouse.y, down: G.input.mouse.down})`);
    console.log('鼠标事件后 input.mouse = ' + JSON.stringify(mouseState) + '  期望 x=' + Math.round(pos.x));

    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(100);
    const afterDown = await cdp.eval(`({down: G.input.mouse.down, clicked: G.input.mouse.clicked, cd: G.player.state.attackCd.toFixed(2)})`);
    console.log('mousePressed 后 = ' + JSON.stringify(afterDown));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(500);
    const after = await cdp.eval(`(function(){
      var e = G.enemy.list.find(function(x){return x.id === ${before.id};});
      return {hp: e ? e.hp : -1};
    })()`);
    console.log('CDP 真实点击: hp ' + before.hp + ' -> ' + after.hp);
  }

  // ---------- B. 闪避 ----------
  console.log('\n=== B. 闪避诊断 ===');
  const dodgeBefore = await cdp.eval(`({cd: G.player.state.dodge.cd, timer: G.player.state.dodge.timer})`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16 });
  await sleep(80);
  const dodgeDown = await cdp.eval(`({pressedDodge: !!G.input.pressed.dodge, keysDodge: !!G.input.keys.dodge})`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16 });
  await sleep(200);
  const dodgeAfter = await cdp.eval(`({cd: G.player.state.dodge.cd, timer: G.player.state.dodge.timer})`);
  console.log('before=' + JSON.stringify(dodgeBefore) + ' keydown=' + JSON.stringify(dodgeDown) + ' after=' + JSON.stringify(dodgeAfter));

  // 检查 KEYMAP 是否有 Shift
  const keymap = await cdp.eval(`(function(){
    // 探测：模拟按下 ShiftLeft 时 KEYMAP 命中什么
    return { hasShift: typeof G.input !== 'undefined' };
  })()`);

  await b.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
