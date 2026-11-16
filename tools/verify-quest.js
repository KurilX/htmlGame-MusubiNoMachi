// tools/verify-quest.js — 任务系统验收
//
// 覆盖：开局引导 / 任务日志 UI / 五类步骤钩子 / Boss 召唤 / 存档往返 / 多地区结构
//
// 目标地址：默认本地 dev.html，也可传参测线上：
//   node tools/verify-quest.js https://kurilx.github.io/htmlGame-MusubiNoMachi/game.html
//
// 【同一个错误犯了第三次】verify-aim / verify-perf / verify-quest 都曾把
// URL 写死成 dev.html，传参被静默忽略，把本地结果当成线上验收。
// 所以：所有验收脚本必须从 argv[2] 读 URL，并在开头打印真实加载地址。
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');

// 【必须带 autostart】主菜单上线后，加载完不会直接进场景。
// 传参测线上时 argv[2] 是原样使用的 —— 如果忘了带 autostart，
// 页面会停在主菜单，所有"等世界构建"的断言全部超时。
function ensureAuto(u) {
  if (!u) return u;
  if (u.indexOf('autostart=') >= 0) return u;
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'autostart=1';
}

const ROOT = path.resolve(__dirname, '..');

const TARGET_URL = ensureAuto(process.argv[2] ||
  ('file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?autostart=1&v=' + Date.now()));

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 任务系统验收 ===');
  console.log('目标地址: ' + TARGET_URL + '\n');

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const errors = [];
  cdp.on('Runtime.exceptionThrown', e => {
    errors.push(e.exceptionDetails.text || 'exception');
  });

  await cdp.send('Page.navigate', { url: TARGET_URL });
  let booted = false;
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    try {
      const ok = await cdp.eval(`(typeof G!=='undefined'&&G.world&&G.world.props&&G.world.props.length>0)?1:0`);
      if (ok === 1) { booted = true; break; }
    } catch (e) {}
  }
  check('游戏启动完成', booted);
  if (!booted) { await b.kill(); process.exit(1); }
  await sleep(2000);

  // ---- 1. 开局自动接主线（新手引导）----
  // ---- 1. 开局状态 ----
  //
  // 【规则已变更】之前是"开局自动接 town_01"，但那是设计错误：
  // 玩家一睁眼就多个任务、没开场、没见过 NPC。
  // 现在改由 G.intro 播开场旁白 → 引导去找千絵 → 对话结束才接任务。
  // 所以这里断言的是**开局没有任务**，开场引导另由 verify-intro.js 覆盖。
  const auto = await cdp.eval(`(function(){
    return {
      active: Object.keys(G.quest.state.active),
      tracked: G.quest.tracked() ? G.quest.tracked().title : null,
      next: G.quest.nextStep() ? G.quest.nextStep().step.text : null,
      introStage: G.intro ? G.intro.stage : -1
    };
  })()`);
  check('开局不自动接任务（由开场剧情带出）', auto.active.length === 0,
    auto.active.length === 0 ? '任务数 0，开场 stage=' + auto.introStage : '异常: ' + auto.active.join(','));

  // ---- 1b. 手动接取后，追踪目标必须正确 ----
  // 前面那条断言"开局没任务"之后，这里主动接一条，
  // 以验证 tracked / nextStep / 追踪 HUD 这套机制本身是好的。
  await cdp.eval(`G.quest.start('town_01')`);
  await sleep(300);

  const tracked = await cdp.eval(`(function(){
    return {
      title: G.quest.tracked() ? G.quest.tracked().title : null,
      next: G.quest.nextStep() ? G.quest.nextStep().step.text : null
    };
  })()`);
  check('接取后追踪目标已确定', !!tracked.title && !!tracked.next,
    tracked.title + ' / ' + tracked.next);

  // ---- 2. 追踪 HUD ----
  //
  // 开场引导进行中时，追踪 HUD 会优先显示「序章｜去找千絵」，
  // 而不是任务标题。这里测的是任务追踪，所以先把开场推到完成态。
  await cdp.eval(`(function(){
    if (G.intro) { G.intro.stage = 3; G.intro.objective = null; }
    return 1;
  })()`);
  await sleep(400);

  // 触发一次追踪刷新（内容缓存在 _trackLastText 里，状态变了要让它重绘）
  await cdp.eval(`(function(){ G.ui.invalidateTracker(); return 1; })()`);

  const hud = await cdp.eval(`(function(){
    var box = G.ui.trackerBox;
    return {
      exists: !!box,
      visible: box ? box.style.display !== 'none' : false,
      title: G.ui.trackerTitle ? G.ui.trackerTitle.textContent : '',
      step: G.ui.trackerStep ? G.ui.trackerStep.textContent : ''
    };
  })()`);
  check('追踪 HUD 存在且可见', hud.exists && hud.visible);
  check('追踪 HUD 显示任务标题与步骤', !!hud.title && !!hud.step, hud.title + ' | ' + hud.step);

  // ---- 3. 任务日志面板（按 L）----
  //
  // 【改为轮询】原来按键后固定 sleep(500) 再断言。
  // 线上版本加载更慢，按键时主循环可能还没消费 pressed 标记，
  // 导致线上偶发失败（本地一直正常）。现在最多等 3 秒，一旦可见就继续。
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyL', key: 'l', windowsVirtualKeyCode: 76 });
  await sleep(120);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyL', key: 'l', windowsVirtualKeyCode: 76 });

  let panel = { visible: false, cards: 0 };
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    panel = await cdp.eval(`(function(){
      var p = G.ui.panels.quest;
      return {
        visible: p ? p.style.display !== 'none' : false,
        cards: p ? p.querySelectorAll('.quest-card').length : 0
      };
    })()`);
    if (panel.visible && panel.cards > 0) break;
  }
  check('按 L 打开任务日志', panel.visible === true);
  check('日志里有任务卡片', panel.cards > 0, panel.cards + ' 张');
  await cdp.eval(`G.ui.closeAllPanels()`);
  await sleep(300);

  // ---- 4. kill 步骤 ----
  const kill = await cdp.eval(`(function(){
    G.quest.state.active = {}; G.quest.state.done = {};
    G.quest.start('town_01');
    for (var i = 0; i < 3; i++) G.quest.onKill('onibi');
    return { done: !!G.quest.state.done['town_01'], next: !!G.quest.state.active['town_02'] };
  })()`);
  check('kill 步骤：击杀 3 只推进并完成', kill.done === true);
  check('完成后自动接下一章', kill.next === true);

  // ---- 5. knot 步骤 ----
  const knot = await cdp.eval(`(function(){
    G.quest.state.active = {}; G.quest.state.done = {};
    G.quest.start('town_02');
    G.quest.onKnot('knot_1');
    G.quest.onKnot('knot_2');
    G.quest.onKnot('knot_3');
    return { done: !!G.quest.state.done['town_02'] };
  })()`);
  check('knot 步骤：系三处结完成', knot.done === true);

  // ---- 6. talk 步骤 ----
  const talk = await cdp.eval(`(function(){
    G.quest.state.active = {}; G.quest.state.done = {};
    G.quest.state.done['town_05'] = true;
    G.quest.start('town_06');
    G.quest.onTalk('npc_chie');
    return { done: !!G.quest.state.done['town_06'] };
  })()`);
  check('talk 步骤：与 NPC 对话完成', talk.done === true);

  // ---- 7. reach 步骤（此前 onReach 没有任何调用点，是断裂的一环）----
  const reach = await cdp.eval(`(function(){
    G.quest.state.active = {}; G.quest.state.done = {};
    G.quest.start('town_04');
    var next = G.quest.nextStep();
    return {
      stepType: next ? next.step.type : null,
      target: next ? next.step.target : null,
      hasCheck: typeof G.quest.checkReach === 'function'
    };
  })()`);
  check('reach 步骤已定义且 checkReach 存在', reach.stepType === 'reach' && reach.hasCheck,
    reach.stepType + ' -> ' + reach.target);

  // ---- 8. Boss 召唤 ----
  const boss = await cdp.eval(`(function(){
    G.quest.state.active = {}; G.quest.state.done = {};
    G.quest.resetRuntime();
    G.quest.start('town_05');
    var gate = null;
    (G.world.interactables || []).forEach(function(it){ if (it.kind === 'gate' && !gate) gate = it; });
    if (!gate) return { err: 'no gate' };
    G.quest.maybeSpawnBoss(gate.uid, gate.x, gate.z);
    var b2 = G.quest.getActiveBoss();
    G.quest.onKill('musubi_no_kami');
    return {
      spawned: !!b2,
      name: b2 && b2.def ? b2.def.name : null,
      hp: b2 ? b2.maxHp : 0,
      questDone: !!G.quest.state.done['town_05']
    };
  })()`);
  check('走到门前召唤 Boss', boss.spawned === true, boss.name + ' HP=' + boss.hp);
  check('击杀 Boss 完成任务', boss.questDone === true);

  // ---- 9. 存档往返 ----
  const save = await cdp.eval(`(function(){
    G.quest.state.active = {}; G.quest.state.done = {};
    G.quest.start('town_01');
    G.quest.start('side_roji_01');
    G.quest.state.done['town_00_probe'] = true;
    var before = { a: Object.keys(G.quest.state.active).sort(), d: Object.keys(G.quest.state.done).sort() };
    G.save.save();
    G.quest.init();
    var loaded = G.save.load(0);
    G.save.deserialize(loaded);
    return {
      before: before,
      after: { a: Object.keys(G.quest.state.active).sort(), d: Object.keys(G.quest.state.done).sort() }
    };
  })()`);
  check('任务状态存档往返',
    JSON.stringify(save.before.a) === JSON.stringify(save.after.a) &&
    JSON.stringify(save.before.d) === JSON.stringify(save.after.d),
    'active ' + save.after.a.length + ' 个, done ' + save.after.d.length + ' 个');

  // ---- 10. NPC 自动派发任务 ----
  const offer = await cdp.eval(`(function(){
    G.quest.state.active = {}; G.quest.state.done = {};
    var offered = G.quest.offerFromNpc('npc_tetsu');
    return {
      offered: offered ? offered.id : null,
      active: Object.keys(G.quest.state.active)
    };
  })()`);
  check('与 NPC 对话自动派发该 NPC 的任务', offer.offered === 'side_tetsu_01', String(offer.offered));

  // ---- 11. 多地区主线结构 ----
  const lines = await cdp.eval(`(function(){
    var l = G.DATA.QUEST_LINES;
    var keys = Object.keys(l);
    var town = l.town;
    var allHaveRegion = true, allHaveChapter = true;
    for (var id in G.DATA.QUESTS) {
      var d = G.DATA.QUESTS[id];
      if (!d.region) allHaveRegion = false;
      if (d.chapter == null) allHaveChapter = false;
    }
    return {
      lineCount: keys.length,
      townOrder: town ? town.order.length : 0,
      allHaveRegion: allHaveRegion,
      allHaveChapter: allHaveChapter,
      questCount: Object.keys(G.DATA.QUESTS).length
    };
  })()`);
  check('存在地区主线索引（可扩展到其他城镇）', lines.lineCount >= 1 && lines.townOrder >= 5,
    lines.lineCount + ' 条主线，結ノ町 ' + lines.townOrder + ' 章');
  check('所有任务都标注 region 与 chapter', lines.allHaveRegion && lines.allHaveChapter,
    '共 ' + lines.questCount + ' 个任务');

  // ---- 12. 无错误 ----
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
