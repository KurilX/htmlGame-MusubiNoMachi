// tools/verify-perf.js — 性能回归测试
//
// 【这个测试防的是什么】
// 曾经有一个极其隐蔽的 bug 导致「走路时每 1~3 秒固定卡一次」：
//
//   src/22-sprite.js 的 lookKey() 在缓存 key 里带了自增序号：
//       look.__key = 'L' + (++lookKeySeq) + ':' + parts.join(',');
//   而 G.makeLook() 每次调用都返回新对象，于是每只怪拿到的 key 都不同
//   -> 图集缓存永不命中 -> 每刷一只怪都重绘 8 方向 x 13 帧的 canvas 图集。
//
// 实测影响：刷一只怪 20~27ms；7 个刷怪区每 1.2 秒补员，
// 走路时穿越多区 => 每 1~3 秒一次 400ms 卡顿（p99 从 26ms 恶化到 132ms）。
//
// 这个测试固化三条不变量：
//   1) 同外观的图集必须命中缓存（第二次取用时接近 0 耗时）
//   2) 连续刷怪的单次开销必须很低
//   3) 走路时不应出现长帧
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 性能回归测试 ===\n');

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });

  let booted = false;
  for (let i = 0; i < 50; i++) {
    await sleep(500);
    try {
      const ok = await cdp.eval(`(typeof G!=='undefined'&&G.world&&G.world.props&&G.world.props.length>0)?1:0`);
      if (ok === 1) { booted = true; break; }
    } catch (e) {}
  }
  check('游戏启动完成', booted, booted ? 'ok' : 'timeout');
  if (!booted) { await b.kill(); process.exit(1); }
  await sleep(1500);

  // ---- 1. 图集缓存必须命中 ----
  const cacheTest = await cdp.eval(`(function(){
    var def = G.DATA.MONSTERS['kappa'];

    // 第一次：走完整路径（可能构建）
    var look1 = G.makeLook(def.look);
    var t0 = performance.now();
    var a1 = G.getChibiAtlas(look1, 'kappa');
    var first = performance.now() - t0;

    // 第二次：新 look 对象，同样内容 -> 必须命中缓存
    var look2 = G.makeLook(def.look);
    var t1 = performance.now();
    var a2 = G.getChibiAtlas(look2, 'kappa');
    var second = performance.now() - t1;

    return {
      sameAtlas: a1 === a2,
      first: +first.toFixed(2),
      second: +second.toFixed(2),
      key1: look1.__key,
      key2: look2.__key
    };
  })()`);

  check('同外观的两次 makeLook 得到相同 key',
    cacheTest.key1 === cacheTest.key2,
    cacheTest.key1 === cacheTest.key2 ? 'key 一致' : (cacheTest.key1 + ' != ' + cacheTest.key2));

  check('第二次取图集命中缓存（<2ms）',
    cacheTest.second < 2,
    '首次 ' + cacheTest.first + 'ms -> 二次 ' + cacheTest.second + 'ms');

  check('两次返回同一个 atlas 对象',
    cacheTest.sameAtlas === true,
    String(cacheTest.sameAtlas));

  // ---- 2. 连续刷怪开销 ----
  const spawnTest = await cdp.eval(`(function(){
    // 预热一次
    G.enemy.spawn('kappa', 5, 30, G.world.spawnZones[0]);

    var t0 = performance.now();
    for (var i = 0; i < 10; i++) {
      G.enemy.spawn('kappa', 5 + i * 0.3, 30, G.world.spawnZones[0]);
    }
    var ms = performance.now() - t0;
    return { total: +ms.toFixed(1), per: +(ms / 10).toFixed(2) };
  })()`);

  check('刷一只怪开销 < 5ms', spawnTest.per < 5,
    '单次 ' + spawnTest.per + 'ms（10 只共 ' + spawnTest.total + 'ms）');

  // ---- 3. 走路时无长帧 ----
  await cdp.eval(`(function(){
    var st = G.player.state;
    st.x = 0; st.z = 20; st.vx = 0; st.vz = 0;
  })()`);
  await sleep(2500);

  const recordPromise = cdp.eval(`
    (function(){
      return new Promise(function(resolve){
        var frames = [], last = performance.now(), t0 = last, n = 0;
        function tick(){
          var now = performance.now();
          frames.push(now - last); last = now; n++;
          if (now - t0 < 6000) requestAnimationFrame(tick);
          else {
            frames.shift();
            frames.sort(function(a,b){ return a-b; });
            var sum = 0;
            for (var i = 0; i < frames.length; i++) sum += frames[i];
            resolve({
              fps: Math.round(1000 / (sum / frames.length)),
              p99: Math.round(frames[Math.floor(frames.length*0.99)]),
              max: Math.round(frames[frames.length-1]),
              long: frames.filter(function(f){ return f > 60; }).length
            });
          }
        }
        requestAnimationFrame(tick);
      });
    })()
  `, true);

  await sleep(200);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  const walk = await recordPromise;
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });

  check('走路时无长帧（>60ms 的次数为 0）', walk.long === 0,
    walk.long + ' 次长帧，最差 ' + walk.max + 'ms');
  check('走路时 p99 < 60ms', walk.p99 < 60, 'p99=' + walk.p99 + 'ms');
  check('走路时帧率 > 50fps', walk.fps > 50, walk.fps + ' fps');

  // ---- 4. 无累积错误 ----
  const errs = await cdp.eval(`(window.__ERRORS__ || []).length`);
  check('全程无 JS 错误', errs === 0, errs + ' errors');

  await b.kill();

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log('\n=== 结果: ' + pass + '/' + results.length + ' 通过 ===');
  if (fail) {
    console.log('\n失败项：');
    results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name + '  ' + (r.detail || '')));
  }
  console.log('\n帧率明细: ' + walk.fps + ' fps, p99=' + walk.p99 + 'ms, 最差=' + walk.max + 'ms, 长帧=' + walk.long);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试异常:', e); process.exit(2); });
