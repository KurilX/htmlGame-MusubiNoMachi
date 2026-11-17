// tools/verify-npc.js — NPC 可辨识度验收
//
// 【为什么需要】
// 用户反馈「npc太扁平了，根本看不见」。实测原因是 NPC 缺了两样
// 玩家和敌人都有的东西：
//   1) 落地阴影（没有阴影 = 看不出"站在地上"，像浮在背景上的纸片）
//   2) 头顶标识（满屏树木房子之间，66px 的人形完全混在背景里）
//
// 本测试锁住这两点，防止以后重构时又丢掉。
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

  console.log('=== NPC 可辨识度验收 ===');
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

  await cdp.eval(`(function(){
    if (G.dlg && G.dlg.active) G.dlg.close();
    if (G.intro) { G.intro.stage = 3; G.intro.objective = null; }
    return 1;
  })()`);
  await sleep(400);

  // ---- 1. 每个 NPC 都要有阴影 ----
  const shadows = await cdp.eval(`(function(){
    var missing = [];
    var ok = 0;
    G.world.npcs.forEach(function(n){
      if (n.shadow && n.shadow.parent) ok++;
      else missing.push(n.def.name);
    });
    return { total: G.world.npcs.length, ok: ok, missing: missing };
  })()`);
  check('**每个 NPC 都有落地阴影**',
    shadows.missing.length === 0,
    shadows.ok + '/' + shadows.total +
    (shadows.missing.length ? '  缺失: ' + shadows.missing.join(',') : ''));

  // ---- 2. 每个 NPC 都要有头顶浮标 ----
  const markers = await cdp.eval(`(function(){
    var missing = [];
    var ok = 0;
    G.world.npcs.forEach(function(n){
      if (n.marker && n.marker.parent && n.marker.children.length >= 2) ok++;
      else missing.push(n.def.name);
    });
    return { total: G.world.npcs.length, ok: ok, missing: missing };
  })()`);
  check('**每个 NPC 都有头顶浮标（≥2 个子元素）**',
    markers.missing.length === 0,
    markers.ok + '/' + markers.total +
    (markers.missing.length ? '  缺失: ' + markers.missing.join(',') : ''));

  // ---- 3. 浮标尺寸要够大（视高 24 时至少 12px） ----
  const size = await cdp.eval(`(function(){
    var npc = G.world.npcs[0];
    var canvas = document.getElementById('gl');
    var ch = canvas.clientHeight;
    // 找最大的那个子平面（菱形本体）
    var maxW = 0;
    npc.marker.children.forEach(function(c){
      if (c.geometry && c.geometry.parameters) {
        maxW = Math.max(maxW, c.geometry.parameters.width || 0);
      }
    });
    var px = (maxW / G.camera.viewH) * ch;
    return { worldW: +maxW.toFixed(2), screenPx: Math.round(px), viewH: G.camera.viewH };
  })()`);
  check('浮标在屏幕上足够醒目（≥12px）', size.screenPx >= 12,
    size.worldW + ' 单位 = ' + size.screenPx + 'px（viewH=' + size.viewH + '）');

  // ---- 4. 浮标始终面向相机 ----
  const facing = await cdp.eval(`(function(){
    var npc = G.world.npcs[0];
    // 先记一个朝向
    G.world.updateNPCs(0.016, 0.5);
    var a = npc.marker.rotation.y;
    // 换相机 yaw
    G.world.updateNPCs(0.016, 1.9);
    var b2 = npc.marker.rotation.y;
    return { a: +a.toFixed(3), b: +b2.toFixed(3), changed: Math.abs(a - b2) > 0.01 };
  })()`);
  check('浮标会跟随相机朝向（billboard）', facing.changed === true,
    facing.a + ' → ' + facing.b);

  // ---- 5. 浮标会浮动（不是静态贴着） ----
  const float = await cdp.eval(`(function(){
    var npc = G.world.npcs[0];
    var ys = [];
    for (var i = 0; i < 30; i++) {
      G.world.updateNPCs(0.05, G.camera.yaw);
      ys.push(npc.marker.position.y);
    }
    var min = Math.min.apply(null, ys);
    var max = Math.max.apply(null, ys);
    return { range: +(max - min).toFixed(3), floats: (max - min) > 0.05 };
  })()`);
  check('浮标有上下浮动（幅度 > 0.05）', float.floats === true,
    '浮动范围 ' + float.range);

  // ---- 6. 浮标不被遮挡（depthTest = false） ----
  const noOcclude = await cdp.eval(`(function(){
    var npc = G.world.npcs[0];
    var all = true;
    npc.marker.children.forEach(function(c){
      if (c.material && c.material.depthTest !== false) all = false;
    });
    return all;
  })()`);
  check('浮标不被建筑/树木遮挡（depthTest=false）', noOcclude === true);

  // ---- 7. NPC 本身仍可见且有正确尺寸 ----
  const npcSize = await cdp.eval(`(function(){
    var npc = G.world.npcs[0];
    var canvas = document.getElementById('gl');
    var ch = canvas.clientHeight;
    return {
      screenPx: Math.round((2.45 / G.camera.viewH) * ch),
      visible: npc.mesh.visible,
      inScene: !!npc.mesh.parent
    };
  })()`);
  check('NPC 本体在场景中且可见', npcSize.visible && npcSize.inScene);
  check('NPC 屏幕尺寸合理（>=50px）', npcSize.screenPx >= 50, npcSize.screenPx + 'px');

  // ---- 8. 昼夜换位时阴影与浮标要跟着走 ----
  const relocate = await cdp.eval(`(function(){
    var npc = G.world.npcs[0];
    var before = { x: npc.x, z: npc.z };
    var beforeShadow = { x: npc.shadow.position.x, z: npc.shadow.position.z };
    var beforeMarker = { x: npc.marker.position.x, z: npc.marker.position.z };

    // 强制换到 night 位置（不管当前昼夜）
    var oldNight = G.world.isNight;
    G.world.isNight = function(){ return true; };
    G.world.relocateNPCs();
    G.world.isNight = oldNight;

    var target = npc.def.night;
    return {
      npcMoved: Math.abs(npc.x - target.x) < 0.01 && Math.abs(npc.z - target.z) < 0.01,
      shadowMoved: Math.abs(npc.shadow.position.x - target.x) < 0.01 &&
                   Math.abs(npc.shadow.position.z - target.z) < 0.01,
      markerMoved: Math.abs(npc.marker.position.x - target.x) < 0.01 &&
                   Math.abs(npc.marker.position.z - target.z) < 0.01
    };
  })()`);
  check('换位时 NPC 移动', relocate.npcMoved === true);
  check('**换位时阴影跟着走**（不会留在原地）', relocate.shadowMoved === true);
  check('**换位时浮标跟着走**', relocate.markerMoved === true);

  // ---- 9. 无错误 ----
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
