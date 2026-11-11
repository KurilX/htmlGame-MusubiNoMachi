// tools/_diag2.js — 精确定位鼠标攻击与闪避
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '..');

(async () => {
  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  console.log('端口 ' + b.port + '\n');

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });
  await sleep(4000);

  // 先推帧把怪刷出来
  for (let i = 0; i < 20; i++) {
    await cdp.eval(`for(var i=0;i<30;i++) G.tickOnce(1/60);`);
    const n = await cdp.eval(`G.enemy.list.length`);
    if (n > 0) { console.log('enemies=' + n); break; }
  }

  // ---------- 闪避：直接看 KEYMAP 命中 ----------
  console.log('\n=== 闪避 ===');
  await cdp.eval(`(function(){
    window.__keylog = [];
    window.addEventListener('keydown', function(e){
      window.__keylog.push({code: e.code, key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey});
    }, true);
  })()`);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', code: 'ShiftLeft', key: 'Shift',
    windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16,
    modifiers: 8
  });
  await sleep(150);
  const keylog = await cdp.eval(`window.__keylog`);
  console.log('收到的 keydown 事件: ' + JSON.stringify(keylog));
  const dodgeState = await cdp.eval(`({pressed: !!G.input.pressed.dodge, keys: !!G.input.keys.dodge})`);
  console.log('input 状态: ' + JSON.stringify(dodgeState));
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });

  // ---------- 鼠标：看事件目标 ----------
  console.log('\n=== 鼠标 ===');
  await cdp.eval(`(function(){
    window.__mouselog = [];
    window.addEventListener('mousedown', function(e){
      var el = e.target;
      window.__mouselog.push({
        x: e.clientX, y: e.clientY,
        target: el ? (el.id || el.className || el.tagName) : 'none',
        closestUi: el && el.closest ? !!el.closest('.overlay, .dialog, .dlg-choice, .sr-buy, .bagitem, .dlg-choices') : 'n/a'
      });
    }, true);
  })()`);

  const pos = await cdp.eval(`(function(){
    var st = G.player.state;
    var e = G.enemy.list[0];
    st.x = e.x - 1.6; st.z = e.z;
    st.attackCd = 0; st.moveLock = 0;
    G.camera.follow.x = st.x; G.camera.follow.z = st.z;
    G.camera.update(0.016, {x: st.x, z: st.z, y: 0.6});
    var p = G.camera.worldToScreen(e.x, 1.2, e.z);
    return {id: e.id, hp: e.hp, x: p.x, y: p.y};
  })()`);
  console.log('目标位置: ' + JSON.stringify(pos));

  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(100);
  const mouselog = await cdp.eval(`window.__mouselog`);
  const inputState = await cdp.eval(`({down: G.input.mouse.down, x: G.input.mouse.x, y: G.input.mouse.y})`);
  console.log('mousedown 事件: ' + JSON.stringify(mouselog));
  console.log('input.mouse: ' + JSON.stringify(inputState));

  // 推帧执行攻击
  await cdp.eval(`for(var i=0;i<5;i++) G.tickOnce(1/60);`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1, buttons: 0 });
  await cdp.eval(`for(var i=0;i<10;i++) G.tickOnce(1/60);`);

  const result = await cdp.eval(`(function(){
    var e = G.enemy.list.find(function(x){return x.id === ${pos.id};});
    return {
      hpNow: e ? e.hp : -1,
      attackCd: G.player.state.attackCd.toFixed(2),
      facing: G.player.state.facing.toFixed(2),
      enemyAngle: e ? Math.atan2(e.x - G.player.state.x, e.z - G.player.state.z).toFixed(2) : 'gone',
      dist: e ? Math.hypot(e.x - G.player.state.x, e.z - G.player.state.z).toFixed(2) : 'gone'
    };
  })()`);
  console.log('攻击后: ' + JSON.stringify(result) + '  (攻击前 hp=' + pos.hp + ')');

  await b.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
