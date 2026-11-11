// tools/shot-area.js — 把相机对准指定世界坐标截图，用于排查区域渲染
// 用法: node tools/shot-area.js <x> <z> <outfile> [viewH]
const path = require('path');
const fs = require('fs');
const { launchOwnChrome, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const tx = parseFloat(args[0] || '0');
const tz = parseFloat(args[1] || '26');
const out = args[2] || 'area.png';
const viewH = parseFloat(args[3] || '24');

(async () => {
  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  // file:// 下浏览器会缓存同目录的 JS，改完代码看不到效果（踩过）。
  // 彻底禁用缓存 + cacheBust 双保险。
  try {
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  } catch (e) {}
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });
  await sleep(4000);

  await cdp.eval(`(function(){
    G.player.state.x = ${tx};
    G.player.state.z = ${tz};
    G.camera.follow.x = ${tx};
    G.camera.follow.z = ${tz};
    G.camera.viewH = ${viewH};
    G.camera.resize(16/9);
    G.camera.update(0.016, {x: ${tx}, z: ${tz}, y: 0.6});
    // 白天，看得清
    G.world.timeOfDay = 0.42;
    for (var i = 0; i < 5; i++) G.tickOnce(1/60);
  })()`);
  await sleep(700);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(ROOT, 'tools', out);
  fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
  console.log('saved: ' + p + '  (target ' + tx + ',' + tz + ')');

  await b.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
