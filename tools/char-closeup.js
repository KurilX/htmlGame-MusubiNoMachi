// tools/char-closeup.js — 把角色单帧放大 8 倍，用于判断细节缺失
const path = require('path');
const fs = require('fs');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const b = await launchOwnChrome({ width: 1400, height: 900 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });
  await sleep(4200);

  // 直接构建一张放大对比图：主角 8 方向 x 各动作
  const dataUrl = await cdp.eval(`(function(){
    var atlas = G.getChibiAtlas(G.player.look, 'player');
    var src = atlas.canvas;
    var scale = 6;
    var out = document.createElement('canvas');
    out.width = src.width * scale;
    out.height = src.height * scale;
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // 深色底，便于看清浅色描边
    ctx.fillStyle = '#3a4450';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  })()`);

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(path.join(ROOT, 'tools', 'char-current.png'), Buffer.from(base64, 'base64'));
  console.log('saved tools/char-current.png');
  console.log('atlas 尺寸信息:');
  const info = await cdp.eval(`(function(){
    var a = G.getChibiAtlas(G.player.look, 'player');
    return { cw: a.cw, ch: a.ch, cols: a.cols, rows: a.rows,
             worldH: G.player.mesh.userData.worldH };
  })()`);
  console.log(JSON.stringify(info));

  await b.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
