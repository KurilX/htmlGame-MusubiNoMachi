// tools/_diag4.js — 追踪 basicAttack 内部的输入值
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

  // 刷怪
  for (let i = 0; i < 20; i++) {
    await cdp.eval(`for(var i=0;i<30;i++) G.tickOnce(1/60);`);
    if (await cdp.eval(`G.enemy.list.length`) > 0) break;
  }

  // 包一层 basicAttack 记录内部值
  const r = await cdp.eval(`(function(){
    var st = G.player.state;
    var e = G.enemy.list[0];
    st.x = e.x - 1.6; st.z = e.z;
    st.attackCd = 0; st.moveLock = 0;
    G.camera.follow.x = st.x; G.camera.follow.z = st.z;
    G.camera.update(0.016, {x: st.x, z: st.z, y: 0.6});

    var p = G.camera.worldToScreen(e.x, 1.2, e.z);

    // 手动复现 basicAttack 内部的换算
    var g = G.camera.screenToGround(p.x, p.y);
    var dx = g.x - st.x, dz = g.z - st.z;
    var wouldFacing = Math.atan2(dx, dz);
    var enemyAngle = Math.atan2(e.x - st.x, e.z - st.z);

    return {
      enemy: {x: e.x.toFixed(2), z: e.z.toFixed(2), id: e.id},
      player: {x: st.x.toFixed(2), z: st.z.toFixed(2)},
      screen: {x: p.x.toFixed(1), y: p.y.toFixed(1)},
      ground: {x: g.x.toFixed(2), z: g.z.toFixed(2)},
      wouldFacing: wouldFacing.toFixed(3),
      enemyAngle: enemyAngle.toFixed(3),
      angleDiff: Math.abs(wouldFacing - enemyAngle).toFixed(3),
      attackRangeNeeded: Math.hypot(e.x - st.x, e.z - st.z).toFixed(2),
      canvasRect: (function(){
        var r = G.pixels.renderer.domElement.getBoundingClientRect();
        return {left: r.left.toFixed(0), top: r.top.toFixed(0), w: r.width.toFixed(0), h: r.height.toFixed(0)};
      })()
    };
  })()`);
  console.log(JSON.stringify(r, null, 2));

  await b.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
