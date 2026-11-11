// tools/_diag5.js — 单步追踪闪避
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });
  await sleep(4000);

  // 记录 dodge 调用
  await cdp.eval(`(function(){
    window.__dodgeLog = [];
    var orig = G.player.dodge;
    G.player.dodge = function(){
      window.__dodgeLog.push('called');
      try { return orig.apply(this, arguments); }
      catch(e) { window.__dodgeLog.push('THREW: ' + e.message); }
    };
  })()`);

  console.log('初始 dodge 状态: ' + JSON.stringify(await cdp.eval(`G.player.state.dodge`)));

  // 模拟按键
  await cdp.eval(`G.player.state.dodge.cd = 0; G.player.state.dodge.timer = 0;`);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', code: 'ShiftLeft', key: 'Shift',
    windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 8
  });

  const s1 = await cdp.eval(`({pressed: !!G.input.pressed.dodge, keys: !!G.input.keys.dodge, cd: G.player.state.dodge.cd, timer: G.player.state.dodge.timer})`);
  console.log('keydown 后、推帧前: ' + JSON.stringify(s1));

  // 单步一帧，立刻看
  const s2 = await cdp.eval(`(function(){
    G.tickOnce(1/60);
    return {cd: G.player.state.dodge.cd, timer: G.player.state.dodge.timer, log: window.__dodgeLog.slice()};
  })()`);
  console.log('推 1 帧后: ' + JSON.stringify(s2));

  const s3 = await cdp.eval(`(function(){
    for(var i=0;i<3;i++) G.tickOnce(1/60);
    return {cd: G.player.state.dodge.cd, timer: G.player.state.dodge.timer, log: window.__dodgeLog.slice()};
  })()`);
  console.log('再推 3 帧: ' + JSON.stringify(s3));

  await b.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
