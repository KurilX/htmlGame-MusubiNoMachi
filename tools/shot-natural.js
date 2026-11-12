// tools/shot-natural.js — 用游戏自身的相机截图（不手动改相机参数）
//
// 【为什么要这个工具】
// tools/shot-area.js 会手动设 viewH/camera.update，在放大视野时
// 算出的画面可能和玩家真实所见不一致（我排查蓝色区域时被绕了很久）。
// 这个工具只做一件事：把玩家瞬移到目标点，然后**等真实 rAF 自然收敛**，
// 再截图。测的就是玩家实际看到的画面。
const path = require('path');
const fs = require('fs');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const x = parseFloat(process.argv[2] || '0');
  const z = parseFloat(process.argv[3] || '0');
  const outName = process.argv[4] || 'natural.png';
  const holdMs = parseInt(process.argv[5] || '1500', 10);

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  try { await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });
  await sleep(5500);

  // 只瞬移玩家，不动相机参数
  await cdp.eval(`(function(){
    var st = G.player.state;
    st.x = ${x}; st.z = ${z};
    st.vx = 0; st.vz = 0;
    G.world.timeOfDay = 0.42;
  })()`);

  // 等真实 rAF 让相机自然跟随过来（camera.update 用 lerp 0.13/帧，约 30 帧收敛）
  await sleep(holdMs);

  const state = await cdp.eval(`(function(){
    var st = G.player.state;
    return {
      player: [+st.x.toFixed(1), +st.z.toFixed(1)],
      groundY: +G.world.groundY(st.x, st.z).toFixed(2),
      camFollow: [+G.camera.follow.x.toFixed(1), +G.camera.follow.y.toFixed(1), +G.camera.follow.z.toFixed(1)],
      viewH: G.camera.viewH,
      region: G.terrain.regionAt(st.x, st.z)
    };
  })()`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'tools', outName), Buffer.from(shot.data, 'base64'));

  console.log('玩家 (' + state.player[0] + ', ' + state.player[1] + ')  地面 y=' + state.groundY +
              '  区域=' + state.region + '  viewH=' + state.viewH);
  console.log('相机 follow (' + state.camFollow.join(', ') + ')');
  console.log('saved tools/' + outName);

  await b.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(2); });
