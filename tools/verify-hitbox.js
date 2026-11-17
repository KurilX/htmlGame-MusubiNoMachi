// tools/verify-hitbox.js — 技能命中判定与特效范围一致性验收
//
// 【为什么需要】
// 用户反馈：「技能的命中判定跟实际的特效范围区别好像有点大，
// 特效命中了但是却没有伤害」。
//
// 实测确认：抜刀・月影 的特效是 外径 radius*1.1、张角 PI*0.72（129.6°），
// 而判定是 外径 radius、张角 def.arc（108°）——
// 特效比判定**大 10% 外径、宽 20% 张角**，于是出现"刀光扫到了却不掉血"。
//
// 本测试的做法：**真的把特效 mesh 建出来，读它的几何参数**，
// 与判定的入参对比。不靠注释、不靠手抄常量。
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

function ensureAuto(u) {
  if (!u) return u;
  if (u.indexOf('autostart=') >= 0) return u;
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'autostart=1';
}

const TARGET_URL = ensureAuto(process.argv[2] ||
  ('file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()));

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 技能判定/特效一致性验收 ===');
  console.log('目标地址: ' + TARGET_URL + '\n');

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const errors = [];
  cdp.on('Runtime.exceptionThrown', e => { errors.push(e.exceptionDetails.text || 'exception'); });

  await cdp.send('Page.navigate', { url: TARGET_URL });
  let booted = false;
  for (let i = 0; i < 80; i++) {
    await sleep(400);
    try {
      if (await cdp.eval(`(G.world.props&&G.world.props.length>0)?1:0`) === 1) { booted = true; break; }
    } catch (e) {}
  }
  check('游戏启动完成', booted);
  if (!booted) { await b.kill(); process.exit(1); }
  await sleep(1500);

  // 清掉开场，避免对话干扰
  await cdp.eval(`(function(){
    if (G.intro) { G.intro.stage = 3; G.intro.objective = null; }
    if (G.dlg && G.dlg.active) G.dlg.close();
    return 1;
  })()`);
  await sleep(300);

  // ---- 1. 抜刀・月影：实际建出特效 mesh，读几何 ----
  //
  // 做法：清场景里的特效 mark，调 moonSlash，然后找新增的 RingGeometry。
  const moon = await cdp.eval(`(function(){
    var def = G.DATA.SKILLS[1];
    var before = G.world.scene.children.length;

    // 立刻把延迟层也跑出来（delayed 是帧驱动的队列）
    G.fx.moonSlash(0, 0, 0, def.radius, def.arc);
    // 只推 2 帧：特效寿命 0.28s，推多了就结束了读不到
    G.fx.update(1/60); G.fx.update(1/60);

    // 找所有 RingGeometry
    var rings = [];
    G.world.scene.traverse(function(o){
      if (o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') {
        var p = o.geometry.parameters;
        // 只要扇形（thetaLength < 2PI），排除中心爆点的整圈粒子环
        if (p && p.thetaLength < Math.PI * 1.9) rings.push({
          inner: +p.innerRadius.toFixed(4),
          outer: +p.outerRadius.toFixed(4),
          thetaStart: +p.thetaStart.toFixed(4),
          thetaLength: +p.thetaLength.toFixed(4),
          scaleX: +o.scale.x.toFixed(3)
        });
      }
    });

    // 清理本次创建的特效
    for (var j = G.world.scene.children.length - 1; j >= before; j--) {
      var c = G.world.scene.children[j];
      if (c && c.parent) c.parent.remove(c);
    }

    return {
      radius: def.radius,
      arc: def.arc,
      arcDeg: +(def.arc * 180 / Math.PI).toFixed(1),
      rings: rings
    };
  })()`);

  // 期望：特效外径 == def.radius，张角 == def.arc（误差 < 2%）
  const outerOk = moon.rings.length > 0 &&
    moon.rings.every(r => Math.abs(r.outer - moon.radius) / moon.radius < 0.02);
  const spanOk = moon.rings.length > 0 &&
    moon.rings.every(r => Math.abs(r.thetaLength - moon.arc) / moon.arc < 0.02);

  check('抜刀・月影：特效外径 == 判定半径',
    outerOk,
    moon.rings.length
      ? '特效 ' + moon.rings[0].outer + ' vs 判定 ' + moon.radius
      : '没找到特效 ring');
  check('抜刀・月影：特效张角 == 判定 arc',
    spanOk,
    moon.rings.length
      ? '特效 ' + (moon.rings[0].thetaLength * 180 / Math.PI).toFixed(1) + '° vs 判定 ' + moon.arcDeg + '°'
      : '没找到特效 ring');
  check('抜刀・月影：特效不再随动画放大（避免末段超出判定）',
    moon.rings.length > 0 && moon.rings.every(r => r.scaleX <= 1.001),
    moon.rings.length ? 'scale=' + moon.rings[0].scaleX : '-');

  // ---- 2. 普攻：slashArc 也要与判定一致 ----
  //
  // 【必须先清场】前一段 moonSlash 的 ring 还在场景里（寿命 0.28s），
  // 而且它的**第二层挂在 delayed 队列**里，会在后续帧被创建出来。
  // 不清掉队列与存活对象，会把它的几何误读成普攻的。
  await cdp.eval(`(function(){
    if (G.fx.clear) G.fx.clear();
    return 1;
  })()`);
  await sleep(200);

  const slash = await cdp.eval(`(function(){
    var before = G.world.scene.children.length;
    var arc = Math.PI * 0.75, radius = 2.3;
    G.fx.slashArc(0, 0, 0, radius, arc);
    G.fx.update(1/60); G.fx.update(1/60);

    var rings = [];
    G.world.scene.traverse(function(o){
      if (o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') {
        var p = o.geometry.parameters;
        if (p) rings.push({
          outer: +p.outerRadius.toFixed(4),
          thetaLength: +p.thetaLength.toFixed(4)
        });
      }
    });
    for (var j = G.world.scene.children.length - 1; j >= before; j--) {
      var c = G.world.scene.children[j];
      if (c && c.parent) c.parent.remove(c);
    }
    return { radius: radius, arc: arc, rings: rings };
  })()`);
  check('普攻：特效外径 == 判定半径',
    slash.rings.length > 0 &&
    slash.rings.every(r => Math.abs(r.outer - slash.radius) / slash.radius < 0.02),
    slash.rings.length ? '特效 ' + slash.rings[0].outer + ' vs 判定 ' + slash.radius : '无');
  check('普攻：特效张角 == 判定 arc',
    slash.rings.length > 0 &&
    slash.rings.every(r => Math.abs(r.thetaLength - slash.arc) / slash.arc < 0.02),
    slash.rings.length
      ? '特效 ' + (slash.rings[0].thetaLength * 180 / Math.PI).toFixed(1) +
        '° vs 判定 ' + (slash.arc * 180 / Math.PI).toFixed(1) + '°'
      : '无');

  // ---- 3. 弹反：parryFlash 的 arc 要与 tryParry 的判定一致 ----
  await cdp.eval(`(function(){ if (G.fx.clear) G.fx.clear(); return 1; })()`);
  await sleep(200);

  const parry = await cdp.eval(`(function(){
    var before = G.world.scene.children.length;
    G.fx.parryFlash(0, 0, 0);
    G.fx.update(1/60); G.fx.update(1/60);
    var rings = [];
    G.world.scene.traverse(function(o){
      if (o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') {
        var p = o.geometry.parameters;
        if (p && p.thetaLength < Math.PI * 1.9) rings.push({ thetaLength: +p.thetaLength.toFixed(4), outer: +p.outerRadius.toFixed(4) });
      }
    });
    for (var j = G.world.scene.children.length - 1; j >= before; j--) {
      var c = G.world.scene.children[j];
      if (c && c.parent) c.parent.remove(c);
    }
    // 判定的 arc 来自 S.tryParry 里写死的 Math.PI * 0.5
    return { rings: rings, expectArc: Math.PI * 0.5, expectRadius: 3.2 };
  })()`);
  check('弹反：特效张角 == 判定 arc（90°）',
    parry.rings.length > 0 &&
    parry.rings.some(r => Math.abs(r.thetaLength - parry.expectArc) / parry.expectArc < 0.02),
    parry.rings.length ? '特效 ' + (parry.rings[0].thetaLength * 180 / Math.PI).toFixed(1) + '°' : '无');

  // ---- 4. 判定本身：扇形边缘该中的要中、不该中的不中 ----
  const coneTest = await cdp.eval(`(function(){
    var def = G.DATA.SKILLS[1];
    var st = G.player.state;
    st.x = 0; st.z = 0;

    // 清场
    if (G.enemy.list) {
      G.enemy.list.forEach(function(e){ if (e.mesh && e.mesh.parent) e.mesh.parent.remove(e.mesh); });
      G.enemy.list.length = 0;
    }

    function place(dist, angDeg, tag) {
      var a = angDeg * Math.PI / 180;
      var e = G.enemy.spawn('onibi', Math.sin(a) * dist, Math.cos(a) * dist, null);
      if (!e) return null;
      e.hp = e.maxHp = 99999;
      e.tag = tag;
      return e;
    }

    var half = def.arc / 2 * 180 / Math.PI;
    // 三个点：正前、张角内 80%、张角外 120%
    var inside = place(def.radius * 0.8, 0, 'center');
    var edgeIn = place(def.radius * 0.8, half * 0.8, 'edgeIn');
    var edgeOut = place(def.radius * 0.8, half * 1.2, 'edgeOut');

    G.combat.cone({
      x: 0, z: 0, angle: 0, arc: def.arc, radius: def.radius,
      damage: 50, source: 'player'
    });

    var out = {
      half,
      center: inside ? inside.hp < 99999 : null,
      edgeIn: edgeIn ? edgeIn.hp < 99999 : null,
      edgeOut: edgeOut ? edgeOut.hp < 99999 : null
    };

    G.enemy.list.forEach(function(e){ if (e.mesh && e.mesh.parent) e.mesh.parent.remove(e.mesh); });
    G.enemy.list.length = 0;
    return out;
  })()`);
  check('判定：正前方必中', coneTest.center === true);
  check('判定：张角内（80%）必中', coneTest.edgeIn === true);
  check('判定：张角外（120%）不中', coneTest.edgeOut === false,
    '半角 ' + coneTest.half.toFixed(1) + '°');

  // ---- 5. 无错误 ----
  check('全程无 JS 错误', errors.length === 0, errors.length + ' errors');

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
