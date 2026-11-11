// tools/_diag3.js — 验证 screenToGround 的数学正确性
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

  // 往返测试：取若干世界点 -> 投到屏幕 -> 反投影回地面 -> 应该回到原点
  const r = await cdp.eval(`(function(){
    var st = G.player.state;
    st.x = 0; st.z = 20;
    G.camera.follow.x = 0; G.camera.follow.z = 20;
    G.camera.update(0.016, {x: 0, z: 20, y: 0.6});

    var tests = [
      {x: 0, z: 20},   // 玩家脚下
      {x: 4, z: 20},   // 右
      {x: -4, z: 20},  // 左
      {x: 0, z: 24},   // 前
      {x: 0, z: 16},   // 后
      {x: 3, z: 23},   // 右上
    ];
    var out = [];
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      var s = G.camera.worldToScreen(t.x, 0, t.z);
      var g = G.camera.screenToGround(s.x, s.y);
      out.push({
        world: t.x.toFixed(1) + ',' + t.z.toFixed(1),
        screen: s.x.toFixed(0) + ',' + s.y.toFixed(0),
        back: g.x.toFixed(2) + ',' + g.z.toFixed(2),
        err: Math.hypot(g.x - t.x, g.z - t.z).toFixed(2)
      });
    }
    return { yaw: G.camera.yaw.toFixed(3), tests: out };
  })()`);
  console.log('yaw=' + r.yaw);
  r.tests.forEach(t => console.log('  world(' + t.world + ') -> screen(' + t.screen + ') -> back(' + t.back + ')  err=' + t.err));

  // 检查 screenDirToWorld 的正交性
  const dir = await cdp.eval(`(function(){
    var C = G.camera;
    var right = C.screenDirToWorld(1, 0);
    var down = C.screenDirToWorld(0, 1);
    // 屏幕右与屏幕下在世界里应当正交
    var dot = right.x * down.x + right.z * down.z;
    return {
      right: right.x.toFixed(3) + ',' + right.z.toFixed(3),
      down: down.x.toFixed(3) + ',' + down.z.toFixed(3),
      dot: dot.toFixed(3),
      yaw: C.yaw.toFixed(3)
    };
  })()`);
  console.log('\nscreenDirToWorld: ' + JSON.stringify(dir));

  await b.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
