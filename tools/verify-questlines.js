// tools/verify-questlines.js — 四条地区主线验收
//
// 覆盖：四条主线数据完整性 / 链式推进 / 三个新 NPC 存在且能接任务 /
//       地区进入提示 / reach 目标不再只限 gate / 全链跑通模拟
//
// 目标地址：默认本地 dev.html，也可传参测线上。
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

const TARGET_URL = process.argv[2] ||
  ('file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now());

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 地区主线验收 ===');
  console.log('目标地址: ' + TARGET_URL + '\n');

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const errors = [];
  cdp.on('Runtime.exceptionThrown', e => { errors.push(e.exceptionDetails.text || 'exception'); });

  await cdp.send('Page.navigate', { url: TARGET_URL });
  let booted = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const ok = await cdp.eval(`(typeof G!=='undefined'&&G.world&&G.world.props&&G.world.props.length>0)?1:0`);
      if (ok === 1) { booted = true; break; }
    } catch (e) {}
  }
  check('游戏启动完成', booted);
  if (!booted) { await b.kill(); process.exit(1); }
  await sleep(2000);

  // ---- 1. 四条主线数据完整 ----
  const lines = await cdp.eval(`(function(){
    var out = [];
    for (var k in G.DATA.QUEST_LINES) {
      var L = G.DATA.QUEST_LINES[k];
      var missing = [], noGiver = [], broken = [];
      L.order.forEach(function(id, i){
        var d = G.DATA.QUESTS[id];
        if (!d) { missing.push(id); return; }
        if (!d.giver) noGiver.push(id);
        if (i < L.order.length - 1 && d.nextId !== L.order[i + 1]) broken.push(id);
      });
      out.push({
        region: k, name: L.name, chapters: L.order.length,
        missing: missing, noGiver: noGiver, broken: broken,
        hasBoss: L.order.some(function(id){
          var d = G.DATA.QUESTS[id];
          return d && d.steps.some(function(s){ return s.type === 'boss'; });
        }),
        hasKill: L.order.some(function(id){
          var d = G.DATA.QUESTS[id];
          return d && d.steps.some(function(s){ return s.type === 'kill'; });
        })
      });
    }
    return out;
  })()`);

  check('地区主线数量 = 4', lines.length === 4, lines.map(l => l.name).join(', '));
  check('所有主线任务数据齐全（无缺失/无空缺 giver）',
    lines.every(l => l.missing.length === 0 && l.noGiver.length === 0),
    lines.map(l => l.name + ':' + l.chapters + '章').join(' '));
  check('所有主线的 nextId 链完整', lines.every(l => l.broken.length === 0));
  check('每条主线都含打怪环节', lines.every(l => l.hasKill));
  check('每条主线都含 Boss 环节', lines.every(l => l.hasBoss));

  // ---- 2. 三个新 NPC ----
  const npcs = await cdp.eval(`(function(){
    var ids = ['npc_kannushi', 'npc_amimoto', 'npc_umibe'];
    return ids.map(function(id){
      var n = G.world.npcs.find(function(x){ return x.def.id === id; });
      return {
        id: id,
        exists: !!n,
        name: n ? n.def.name : null,
        region: n ? G.terrain.regionAt(n.x, n.z) : null,
        hasOffer: G.quest.npcHasOffer(id)
      };
    });
  })()`);
  check('三个新地区 NPC 都已生成', npcs.every(n => n.exists),
    npcs.map(n => n.name).join(', '));
  check('每个 NPC 都在自己的地区',
    npcs[0].region === 'mountain' && npcs[1].region === 'harbor' && npcs[2].region === 'beach',
    npcs.map(n => n.region).join(', '));
  check('每个 NPC 都能派发任务', npcs.every(n => n.hasOffer));

  // ---- 3. reach 目标不再只限 gate ----
  const reachMulti = await cdp.eval(`(function(){
    // 找一个指向 stele 的 reach 步骤（渚主线第 2 章）
    var d = G.DATA.QUESTS['bch_02'];
    var step = d && d.steps.find(function(s){ return s.type === 'reach'; });
    if (!step) return { found: false };
    var it = (G.world.interactables || []).find(function(x){ return x.uid === step.target; });
    return {
      found: true,
      target: step.target,
      kind: it ? it.kind : null,
      exists: !!it
    };
  })()`);
  check('reach 可以指向非 gate 的可交互物（碑文）',
    reachMulti.found && reachMulti.exists && reachMulti.kind !== 'gate',
    reachMulti.target + ' (kind=' + reachMulti.kind + ')');

  // ---- 4. 逐条主线全链跑通 ----
  for (const L of lines) {
    const r = await cdp.eval(`(function(){
      G.quest.state.active = {};
      G.quest.state.done = {};
      G.quest.resetRuntime();
      var L = G.DATA.QUEST_LINES['${L.region}'];
      G.quest.start(L.startId);
      var guard = 0;
      while (guard++ < 50) {
        var t = G.quest.tracked();
        if (!t) break;
        var next = G.quest.nextStep();
        if (!next) break;
        var s = next.step;
        if (s.type === 'kill') {
          for (var i = 0; i < (s.count || 1); i++) G.quest.onKill(s.target);
        } else if (s.type === 'boss') {
          G.quest.onKill(s.target);
        } else if (s.type === 'knot') {
          G.quest.onKnot(s.target);
        } else if (s.type === 'talk') {
          G.quest.onTalk(s.target);
        } else if (s.type === 'reach') {
          G.quest.onReach(s.target);
        } else if (s.type === 'collect') {
          G.quest.onCollect(s.target, s.count || 1);
        } else break;
      }
      return {
        done: Object.keys(G.quest.state.done).length,
        lineDone: G.quest.lineCompleted('${L.region}')
      };
    })()`);
    check('主线「' + L.name + '」全 ' + L.chapters + ' 章可跑通',
      r.lineDone === true && r.done === L.chapters,
      '完成 ' + r.done + '/' + L.chapters);
  }

  // ---- 5. 地区进入提示 ----
  const hint = await cdp.eval(`(function(){
    G.quest.resetRegionSeen();
    G.quest.state.active = {};
    G.quest.state.done = {};
    var st = G.player.state;
    st.x = 0; st.z = 120;
    G.quest.tickRegion(0.016, st);
    var toasts = document.querySelectorAll('.toast');
    var texts = [];
    for (var i = 0; i < toasts.length; i++) texts.push(toasts[i].textContent);
    return { region: G.terrain.regionAt(st.x, st.z), texts: texts };
  })()`);
  const hintOk = hint.texts.some(t => t.indexOf('神山') >= 0 && t.indexOf('宮司') >= 0);
  check('进入新地区时提示去找谁（含发布者名字）', hintOk,
    hint.region + ': ' + hint.texts.slice(-1)[0]);

  // ---- 6. 三条主线都有独立发布者 ----
  const givers = await cdp.eval(`(function(){
    var g = {};
    for (var k in G.DATA.QUEST_LINES) g[k] = G.DATA.QUEST_LINES[k].giver;
    return g;
  })()`);
  const uniq = new Set(Object.values(givers));
  check('四条主线各自有独立发布者', uniq.size === 4,
    Object.keys(givers).map(k => k + ':' + givers[k]).join(' '));

  // ---- 7. 无错误 ----
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
