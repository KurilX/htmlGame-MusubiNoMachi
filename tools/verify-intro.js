// tools/verify-intro.js — 开场引导验收
//
// 【为什么需要这个测试】
// 之前开局直接 `G.quest.start('town_01')`，玩家一睁眼就多了个任务，
// 没有开场、没见过 NPC、不知道自己是誰。
// 本测试锁死"必须有剧情才给任务"这条规则，防止以后又图省事塞任务。
//
// 目标地址：默认本地 dev.html，也可传参测线上。
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

  console.log('=== 开场引导验收 ===');
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
    await sleep(500);
    try {
      const ok = await cdp.eval(`(typeof G!=='undefined'&&G.world&&G.world.props&&G.world.props.length>0)?1:0`);
      if (ok === 1) { booted = true; break; }
    } catch (e) {}
  }
  check('游戏启动完成', booted);
  if (!booted) { await b.kill(); process.exit(1); }
  await sleep(2500);

  // ---- 1. 开局绝对不接任务 ----
  const s0 = await cdp.eval(`(function(){
    return {
      stage: G.intro ? G.intro.stage : -1,
      active: Object.keys(G.quest.state.active),
      done: Object.keys(G.quest.state.done),
      hasIntroModule: !!G.intro,
      shouldPlay: G.intro ? G.intro.shouldPlay() : null
    };
  })()`);
  check('开场模块存在', s0.hasIntroModule === true);
  check('全新存档应播开场', s0.shouldPlay === true);
  check('**开局不接任何任务**（必须有剧情才给）',
    s0.active.length === 0 && s0.done.length === 0,
    s0.active.length === 0 ? '任务数 0' : '异常接取: ' + s0.active.join(','));

  // ---- 2. 开场旁白在播 ----
  const s1 = await cdp.eval(`(function(){
    return {
      stage: G.intro.stage,
      dlgActive: G.dlg.active,
      speaker: G.ui.dialogName ? G.ui.dialogName.textContent : '',
      line: G.ui.dialogText ? G.ui.dialogText.textContent : '',
      active: Object.keys(G.quest.state.active).length
    };
  })()`);
  check('开场阶段 = 1（旁白中）', s1.stage === 1, 'stage=' + s1.stage);
  check('开场有旁白对话', s1.dlgActive === true && s1.line.length > 0, s1.line.slice(0, 26));
  check('旁白没有说话人（是独白不是 NPC 对话）', s1.speaker === '',
    '说话人「' + s1.speaker + '」');
  check('旁白期间仍未接任务', s1.active === 0, s1.active + ' 个');

  // ---- 3. 读完旁白 -> 进入引导目标阶段 ----
  let guard = 0;
  while (await cdp.eval('G.dlg.active') && guard++ < 20) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(110);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(230);
  }
  await sleep(800);

  const s2 = await cdp.eval(`(function(){
    return {
      stage: G.intro.stage,
      objective: G.intro.currentObjective(),
      trackerTitle: G.ui.trackerTitle ? G.ui.trackerTitle.textContent : '',
      trackerStep: G.ui.trackerStep ? G.ui.trackerStep.textContent : '',
      trackerVisible: G.ui.trackerBox ? G.ui.trackerBox.style.display !== 'none' : false,
      active: Object.keys(G.quest.state.active).length
    };
  })()`);
  check('旁白结束后进入阶段 2（等待找 NPC）', s2.stage === 2, 'stage=' + s2.stage);
  check('设置了引导目标', !!s2.objective, s2.objective || '(空)');
  check('追踪 HUD 显示「序章」+ 目标',
    s2.trackerVisible && s2.trackerTitle === '序章' && s2.trackerStep === s2.objective,
    s2.trackerTitle + ' / ' + s2.trackerStep);
  check('**此时仍未接任务**（等玩家自己走过去）', s2.active === 0, s2.active + ' 个');

  // ---- 4. 站远处不会触发 ----
  await cdp.eval(`(function(){
    var chie = G.world.npcs.find(function(n){ return n.def.id === 'npc_chie'; });
    var st = G.player.state;
    st.x = chie.x + 12; st.z = chie.z + 12;
    return 1;
  })()`);
  await sleep(1200);
  const far = await cdp.eval(`(function(){
    var chie = G.world.npcs.find(function(n){ return n.def.id === 'npc_chie'; });
    var st = G.player.state;
    return {
      dist: +Math.hypot(chie.x - st.x, chie.z - st.z).toFixed(1),
      dlg: G.dlg.active,
      stage: G.intro.stage,
      active: Object.keys(G.quest.state.active).length
    };
  })()`);
  check('站远处不触发对话', far.dlg === false && far.stage === 2, '距离 ' + far.dist);
  check('站远处不接任务', far.active === 0);

  // ---- 5. 走到千絵面前 -> 自动对话 ----
  await cdp.eval(`(function(){
    var chie = G.world.npcs.find(function(n){ return n.def.id === 'npc_chie'; });
    var st = G.player.state;
    st.x = chie.x + 1.6; st.z = chie.z + 1.6;
    return 1;
  })()`);
  await sleep(1800);

  const at = await cdp.eval(`(function(){
    var chie = G.world.npcs.find(function(n){ return n.def.id === 'npc_chie'; });
    var st = G.player.state;
    return {
      dist: +Math.hypot(chie.x - st.x, chie.z - st.z).toFixed(1),
      dlg: G.dlg.active,
      speaker: G.ui.dialogName ? G.ui.dialogName.textContent : '',
      stage: G.intro.stage,
      active: Object.keys(G.quest.state.active)
    };
  })()`);
  check('走到面前自动开对话（不用按 E）', at.dlg === true, '距离 ' + at.dist);
  check('对话说话人是千絵', at.speaker === '千絵', '「' + at.speaker + '」');
  check('**对话中还没接任务**（读完才给）', at.active.length === 0,
    at.active.length === 0 ? '任务数 0' : '异常: ' + at.active.join(','));

  // ---- 6. 读完对话 -> 任务由剧情带出，且只有一条 ----
  let g2 = 0;
  while (await cdp.eval('G.dlg.active') && g2++ < 20) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(110);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(230);
  }
  await sleep(900);

  const fin = await cdp.eval(`(function(){
    return {
      stage: G.intro.stage,
      objective: G.intro.currentObjective(),
      active: Object.keys(G.quest.state.active),
      trackerTitle: G.ui.trackerTitle ? G.ui.trackerTitle.textContent : '',
      trackerStep: G.ui.trackerStep ? G.ui.trackerStep.textContent : ''
    };
  })()`);
  check('开场阶段 = 3（完成，不再干预）', fin.stage === 3, 'stage=' + fin.stage);
  check('读完对话后接取第一个任务', fin.active.indexOf('town_01') >= 0,
    fin.active.join(',') || '无');
  check('**只接一条任务，不重复派发**', fin.active.length === 1,
    fin.active.length + ' 条: ' + fin.active.join(','));
  check('引导目标已清空', fin.objective === null);
  check('追踪 HUD 切换为任务',
    fin.trackerTitle !== '序章' && !!fin.trackerStep,
    fin.trackerTitle + ' / ' + fin.trackerStep);

  // ---- 7. 读档不重播开场 ----
  const reload = await cdp.eval(`(function(){
    // 模拟"已有进度"的状态
    G.quest.state.done['town_01'] = true;
    G.intro.reset();
    return {
      shouldPlay: G.intro.shouldPlay(),
      stage: G.intro.stage
    };
  })()`);
  check('已有进度时不重播开场', reload.shouldPlay === false);

  // ---- 8. 无错误 ----
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
