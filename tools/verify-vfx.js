// tools/verify-vfx.js — 特效回归测试
//
// 【为什么需要这个测试】
// 曾出现"出村后技能特效范围异常/被吞"的 bug：
// 所有特效的 y 都写死成 0.30~0.40，而野外地面高度是 1.04~8.96，
// 特效被埋在地下最多 8.56 单位。城里地面恒为 0 所以完全正常，
// 造成"村里好好的，一出村就坏"的迷惑现象。
//
// 这个测试固化两条不变量：
//  1) 任何特效的 y 必须 ≈ 该点地面高度 + 预期抬升（不许写死绝对值）
//  2) 反复释放后不得残留（active 队列必须归零）
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 特效回归测试 ===\n');

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  try { await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });
  await sleep(4500);

  // ---- 1. 特效贴地：覆盖城镇（h=0）与野外各处（h>0） ----
  const spots = [
    { name: '城镇中心', x: 0, z: 0 },
    { name: '城镇边缘', x: 0, z: 12 },
    { name: '野外入口', x: 0, z: 20 },
    { name: '野外中段', x: 0, z: 38 },
    { name: '野外深处', x: 0, z: 55 },
    { name: '溪谷', x: -22, z: 35 }
  ];

  const lifts = [
    { fn: 'slashArc', lift: 0.35, call: 'G.fx.slashArc' },
    { fn: 'ringSlash', lift: 0.30, call: 'G.fx.ringSlash' },
    { fn: 'impactRing', lift: 0.25, call: 'G.fx.impactRing' }
  ];

  let allGrounded = true;
  const detail = [];
  for (const s of spots) {
    const r = await cdp.eval(`(function(){
      var x = ${s.x}, z = ${s.z};
      var gY = G.world.groundY(x, z);
      var out = { groundY: +gY.toFixed(2), probes: [] };

      var cases = [
        { name: 'slashArc', call: function(){ G.fx.slashArc(x, z, 0, 2.3, 2.35); } },
        { name: 'ringSlash', call: function(){ G.fx.ringSlash(x, z, 3.0); } },
        { name: 'impactRing', call: function(){ G.fx.impactRing(x, z, 2.0, '#FFFFFF'); } }
      ];

      for (var i = 0; i < cases.length; i++) {
        G.fx.clear();
        cases[i].call();
        var found = null;
        G.world.scene.traverse(function(o){
          if (!found && o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') found = o;
        });
        out.probes.push({
          name: cases[i].name,
          y: found ? +found.position.y.toFixed(2) : null,
          gap: found ? +(found.position.y - gY).toFixed(2) : null
        });
        G.fx.clear();
      }
      return out;
    })()`);

    for (const p of r.probes) {
      // 距地必须在 0.15 ~ 0.6 之间（各特效抬升 0.25~0.35，留余量）
      const ok = p.gap != null && p.gap > 0.15 && p.gap < 0.6;
      if (!ok) allGrounded = false;
      detail.push(`${s.name}/${p.name} gap=${p.gap}`);
    }
  }
  check('所有特效贴地（城镇 + 野外 6 处 × 3 种）', allGrounded, detail.slice(0, 4).join(' '));

  // ---- 2. 野外深处特效不会被埋（回归核心断言） ----
  const deep = await cdp.eval(`(function(){
    var x = 0, z = 55;
    var gY = G.world.groundY(x, z);
    G.fx.clear();
    G.fx.ringSlash(x, z, 3.0);
    var found = null;
    G.world.scene.traverse(function(o){
      if (!found && o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') found = o;
    });
    var y = found ? found.position.y : null;
    G.fx.clear();
    return { groundY: +gY.toFixed(2), vfxY: y == null ? null : +y.toFixed(2) };
  })()`);
  check('野外深处（地面 8.96）特效不埋地',
    deep.vfxY != null && deep.vfxY > deep.groundY,
    `ground=${deep.groundY} vfx=${deep.vfxY}`);

  // ---- 3. 延迟特效走帧循环，不用 setTimeout ----
  //
  // moonSlash 的结构：立即创建 1 个 impactRing + 2 个延迟的月影层。
  // 所以「未推帧时只有 1 个」才是正确行为（那 1 个是 impactRing），
  // 推帧后应变成 3 个（1 + 2 层）。
  const delay = await cdp.eval(`(function(){
    G.fx.clear();
    function countRings() {
      var n = 0;
      G.world.scene.traverse(function(o){
        if (o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') n++;
      });
      return n;
    }
    var before = countRings();
    G.fx.moonSlash(0, 0, 0, 3.4);
    // 立刻数：只应有 impactRing 那 1 个，两个延迟层尚未创建
    var beforeTick = countRings();
    // 推 6 帧（100ms > 45ms 延迟），两层都出现
    for (var i = 0; i < 6; i++) G.tickOnce(1/60);
    var afterTick = countRings();
    return { base: before, beforeTick: beforeTick, afterTick: afterTick };
  })()`);
  // 期望：未推帧刚好 1 个（impactRing），推帧后 3 个（1 + 2 层）
  check('延迟特效由帧循环驱动（推帧前只有立即创建的那个）',
    delay.beforeTick === 1 && delay.afterTick === 3,
    `基线${delay.base} 未推帧=${delay.beforeTick} 推6帧=${delay.afterTick}`);

  // ---- 4. 反复释放无残留 ----
  const leak = await cdp.eval(`(function(){
    G.fx.clear();
    for (var i = 0; i < 5; i++) G.tickOnce(1/60);
    var base = G.fx.activeCount();

    for (var k = 0; k < 60; k++) {
      G.fx.slashArc(0, 38, 0, 2.3, 2.35);
      G.fx.ringSlash(0, 38, 3.0);
      G.fx.moonSlash(0, 38, 0, 3.4);
      G.fx.levelUp(0, 38);
      G.fx.pickupBurst(0, 38, '#E8C25A');
    }
    var peak = G.fx.activeCount();
    for (var j = 0; j < 400; j++) G.tickOnce(1/60);
    return { base: base, peak: peak, final: G.fx.activeCount() };
  })()`);
  check('连发 300 次后完全清理', leak.final === 0,
    `峰值 ${leak.peak} -> 归零 ${leak.final}`);

  // ---- 5. 真实战斗链路 ----
  const combat = await cdp.eval(`(function(){
    G.fx.clear();
    var st = G.player.state;
    st.x = 0; st.z = 38;
    st.skillUnlocked[1] = true; st.skillUnlocked[2] = true;
    for (var i = 0; i < 5; i++) G.tickOnce(1/60);

    for (var k = 0; k < 25; k++) {
      st.skills[1] = { cd: 0 }; st.skills[2] = { cd: 0 };
      G.skills.cast(1, G.DATA.SKILLS[1], st, 0, {x: 0, z: 41});
      G.skills.cast(2, G.DATA.SKILLS[2], st, 0, {x: 0, z: 41});
      G.tickOnce(1/60);
    }
    var peak = G.fx.activeCount();
    for (var j = 0; j < 400; j++) G.tickOnce(1/60);
    return { peak: peak, final: G.fx.activeCount() };
  })()`);
  check('真实技能连发 50 次后无残留', combat.final === 0,
    `峰值 ${combat.peak} -> ${combat.final}`);

  // ---- 6. 无累积错误 ----
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
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试异常:', e); process.exit(2); });
