// tools/_check-color.js — 查运行时 pagoda 材质实际颜色
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  try { await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });
  await sleep(4500);

  const r = await cdp.eval(`(function () {
    var out = { pagodaSpecs: [], meshes: [] };
    // 1) 数据层：zones.js 里 pagoda 的 spec
    for (var i = 0; i < G.DATA.PROPS.length; i++) {
      var s = G.DATA.PROPS[i];
      if (s.type === 'pagoda') out.pagodaSpecs.push({ x: s.x, z: s.z, color: s.color, roof: s.roof });
    }
    // 2) 场景层：实际构建出来的 pagoda 材质色
    for (var j = 0; j < G.world.props.length; j++) {
      var p = G.world.props[j];
      if (p.spec.type !== 'pagoda') continue;
      p.obj.traverse(function (o) {
        if (o.isMesh && o.material && o.material.color) {
          out.meshes.push({
            hex: '#' + o.material.color.getHexString(),
            geo: o.geometry.type,
            y: +o.position.y.toFixed(2)
          });
        }
      });
      break;  // 只看第一座
    }
    return out;
  })()`);

  console.log('数据层 specs:');
  r.pagodaSpecs.forEach(s => console.log('  x=' + s.x + ' z=' + s.z + ' color=' + s.color + ' roof=' + s.roof));
  console.log('\n场景层材质（前 14 个）:');
  r.meshes.slice(0, 14).forEach(m => console.log('  ' + m.hex + '  ' + m.geo + '  y=' + m.y));

  await b.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
