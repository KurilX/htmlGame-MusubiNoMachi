// tools/char-single.js — 只渲染正面待机单帧，放大 12 倍，用于细节迭代
const path = require('path');
const fs = require('fs');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const b = await launchOwnChrome({ width: 900, height: 1100 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });
  await sleep(4200);

  const dataUrl = await cdp.eval(`(function(){
    var atlas = G.getChibiAtlas(G.player.look, 'player');
    var src = atlas.canvas;
    var info = atlas.frames.idle;
    var cw = atlas.cw, ch = atlas.ch;

    // 取正面待机第 0 帧：dir=0, row = idle.startRow
    var single = document.createElement('canvas');
    single.width = cw; single.height = ch;
    var sctx = single.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(src, 0, info.startRow * ch, cw, ch, 0, 0, cw, ch);

    // 放大 12 倍，并加上 48px 边距
    var scale = 12, pad = 48;
    var out = document.createElement('canvas');
    out.width = cw * scale + pad * 2;
    out.height = ch * scale + pad * 2;
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // 浅灰底（看清描边）
    ctx.fillStyle = '#8a9a8a';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(single, pad, pad, cw * scale, ch * scale);
    return out.toDataURL('image/png');
  })()`);

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(path.join(ROOT, 'tools', 'char-single.png'), Buffer.from(base64, 'base64'));
  console.log('saved tools/char-single.png');

  await b.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
