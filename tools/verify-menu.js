// tools/verify-menu.js — 主菜单与存档子菜单验收
//
// 【为什么需要】
// 主菜单改变了游戏的启动结构：以前加载完直接进场景，现在必须先过菜单。
// 这会影响所有既有验收脚本（它们假设"加载完即在场景里"），
// 所以这里要把菜单的行为、以及"进游戏"这条路径都锁死。
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

  console.log('=== 主菜单验收 ===');
  console.log('目标地址: ' + TARGET_URL + '\n');

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const errors = [];
  cdp.on('Runtime.exceptionThrown', e => { errors.push(e.exceptionDetails.text || 'exception'); });

  // 清掉存档，保证"无存档"的初始状态
  await cdp.send('Page.navigate', { url: TARGET_URL });
  let shellReady = false;
  for (let i = 0; i < 80; i++) {
    await sleep(300);
    try {
      if (await cdp.eval('window.__SHELL_READY__===true?1:0') === 1) { shellReady = true; break; }
    } catch (e) {}
  }
  check('壳启动完成（渲染器+相机+菜单，不含世界）', shellReady);
  if (!shellReady) { await b.kill(); process.exit(1); }
  await sleep(1200);

  // ---- 1. 菜单先于世界 ----
  const s1 = await cdp.eval(`(function(){
    return {
      hasMenu: !!G.menu,
      visible: G.menu ? G.menu.visible : null,
      view: G.menu ? G.menu.view : null,
      enteredGame: G.menu ? G.menu.enteredGame : null,
      worldBuilt: !!(G.world && G.world.scene && G.world.props && G.world.props.length > 0),
      hudHidden: (function(){
        var ui = document.getElementById('ui');
        return ui ? ui.style.display === 'none' : null;
      })(),
      inputDisabled: G.input.enabled === false
    };
  })()`);
  check('主菜单模块存在且可见', s1.hasMenu && s1.visible === true);
  check('**菜单先于世界构建**（不先进场景）', s1.worldBuilt === false,
    s1.worldBuilt ? '世界已构建 <<<' : '世界未构建');
  check('尚未进入游戏', s1.enteredGame === false);
  check('菜单期间 HUD 隐藏', s1.hudHidden === true);
  check('菜单期间游戏输入禁用', s1.inputDisabled === true);

  // ---- 2. 四个入口 ----
  const btns = await cdp.eval(`(function(){
    var out = [];
    var list = G.menu.body.querySelectorAll('.menu-btn');
    for (var i = 0; i < list.length; i++) {
      out.push({
        label: (list[i].querySelector('.menu-btn-label') || {}).textContent || '',
        badge: (list[i].querySelector('.menu-badge') || {}).textContent || '',
        disabled: list[i].classList.contains('disabled')
      });
    }
    return out;
  })()`);
  const labels = btns.map(x => x.label);
  check('主菜单有 4 个入口', btns.length === 4, labels.join(' / '));
  check('包含「开始新游戏」', labels.indexOf('开始新游戏') >= 0);
  check('包含「继续游戏」', labels.indexOf('继续游戏') >= 0);
  check('包含「设置」', labels.indexOf('设置') >= 0);

  const online = btns.find(x => x.label === '联网游戏');
  check('「联网游戏」存在但禁用（占位）',
    !!online && online.disabled === true,
    online ? '徽章「' + online.badge + '」' : '缺失');

  const cont = btns.find(x => x.label === '继续游戏');
  check('无存档时「继续游戏」禁用', !!cont && cont.disabled === true);

  // ---- 3. 槽位摘要接口 ----
  const sum = await cdp.eval(`(function(){
    var list = G.save.summarize([1,2,3]);
    return {
      count: list.length,
      allEmpty: list.every(function(x){ return x.exists === false; }),
      hasAnySave: G.save.anySave([1,2,3])
    };
  })()`);
  check('存档摘要返回 3 个槽位', sum.count === 3);
  check('全新环境下 3 个槽位都是空的', sum.allEmpty === true);
  check('anySave 正确报告无存档', sum.hasAnySave === false);

  // ---- 4. 新游戏：槽位视图 ----
  await cdp.eval(`G.menu.go('slots-new')`);
  await sleep(500);
  const sn = await cdp.eval(`(function(){
    return {
      view: G.menu.view,
      cards: G.menu.body.querySelectorAll('.slot-card').length,
      head: (G.menu.body.querySelector('.menu-h') || {}).textContent || ''
    };
  })()`);
  check('「开始新游戏」进入槽位视图', sn.view === 'slots-new', sn.head);
  check('槽位视图有 3 张卡片', sn.cards === 3);

  // ---- 5. 进游戏 ----
  await cdp.eval(`(function(){
    var cards = G.menu.body.querySelectorAll('.slot-card');
    if (cards[0]) cards[0].click();
    return 1;
  })()`);

  // 世界构建需要时间，轮询
  let entered = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const ok = await cdp.eval(`(G.menu.enteredGame && G.world.props && G.world.props.length>0) ? 1 : 0`);
      if (ok === 1) { entered = true; break; }
    } catch (e) {}
  }
  check('点槽位后成功进入游戏', entered);

  await sleep(1500);
  const ingame = await cdp.eval(`(function(){
    return {
      enteredGame: G.menu.enteredGame,
      menuHidden: G.menu.visible === false,
      hudVisible: (function(){
        var ui = document.getElementById('ui');
        return ui ? ui.style.display !== 'none' : null;
      })(),
      inputEnabled: G.input.enabled === true,
      introStage: G.intro ? G.intro.stage : -1,
      questCount: Object.keys(G.quest.state.active).length,
      hasSaveNow: G.save.hasSave(1)
    };
  })()`);
  check('菜单已隐藏', ingame.menuHidden === true);
  check('HUD 已恢复显示', ingame.hudVisible === true);
  check('游戏输入已启用', ingame.inputEnabled === true);
  check('播放开场旁白', ingame.introStage === 1, 'stage=' + ingame.introStage);
  check('**开场不接任务**', ingame.questCount === 0, ingame.questCount + ' 个');
  check('进入游戏后立即写入存档', ingame.hasSaveNow === true);

  // ---- 6. 返回主菜单（Esc） ----
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(150);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 });

  let backToMenu = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      if (await cdp.eval(`G.menu.visible && !G.menu.enteredGame ? 1 : 0`) === 1) { backToMenu = true; break; }
    } catch (e) {}
  }
  check('游戏内按 Esc 返回主菜单', backToMenu);

  const afterBack = await cdp.eval(`(function(){
    return {
      view: G.menu.view,
      contDisabled: G.menu.contBtn ? G.menu.contBtn.classList.contains('disabled') : null,
      hasSave: G.save.anySave([1,2,3])
    };
  })()`);
  check('返回后「继续游戏」变为可用', afterBack.contDisabled === false,
    '存档存在=' + afterBack.hasSave);

  // ---- 7. 继续游戏能读回存档 ----
  await cdp.eval(`G.menu.go('slots-cont')`);
  await sleep(500);
  const sc = await cdp.eval(`(function(){
    var cards = G.menu.body.querySelectorAll('.slot-card');
    var first = cards[0];
    return {
      view: G.menu.view,
      cards: cards.length,
      firstDisabled: first ? first.classList.contains('disabled') : null,
      hasLevel: !!(first && first.querySelector('.slot-lv')),
      levelText: (first && first.querySelector('.slot-lv')) ? first.querySelector('.slot-lv').textContent : ''
    };
  })()`);
  check('「继续游戏」进入槽位视图', sc.view === 'slots-cont');
  check('有存档的槽位可点击', sc.firstDisabled === false);
  check('槽位显示等级', sc.hasLevel === true, sc.levelText);

  await cdp.eval(`(function(){
    var cards = G.menu.body.querySelectorAll('.slot-card');
    if (cards[0]) cards[0].click();
    return 1;
  })()`);

  let resumed = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      if (await cdp.eval(`G.menu.enteredGame && G.world.props && G.world.props.length>0 ? 1 : 0`) === 1) {
        resumed = true; break;
      }
    } catch (e) {}
  }
  check('读档后成功进入游戏', resumed);

  // ---- 8. 设置视图 ----
  await cdp.eval(`G.menu.showFromGame()`);
  await sleep(600);
  await cdp.eval(`G.menu.go('settings')`);
  await sleep(500);
  const st = await cdp.eval(`(function(){
    return {
      view: G.menu.view,
      hasVolume: !!G.menu.body.querySelector('.set-range'),
      hasQuality: !!G.menu.body.querySelector('.set-select'),
      saveRows: G.menu.body.querySelectorAll('.save-row').length,
      hasExport: !!Array.prototype.slice.call(G.menu.body.querySelectorAll('button'))
        .find(function(b){ return b.textContent === '导出'; }),
      hasImport: !!Array.prototype.slice.call(G.menu.body.querySelectorAll('button'))
        .find(function(b){ return b.textContent === '导入'; })
    };
  })()`);
  check('设置视图可打开', st.view === 'settings');
  check('设置含音量滑块', st.hasVolume === true);
  check('设置含画质选择', st.hasQuality === true);
  check('设置含存档列表（3 个槽）', st.saveRows === 3);
  check('设置含导出/导入', st.hasExport && st.hasImport);

  // ---- 9. 画质设置生效 ----
  const q = await cdp.eval(`(function(){
    G.menu._setQuality('low');
    var s = G.menu.qualitySize();
    G.menu._setQuality('high');
    var s2 = G.menu.qualitySize();
    return { low: s, high: s2 };
  })()`);
  check('画质设置映射到内部分辨率',
    q.low.w === 640 && q.low.h === 360 && q.high.w === 1152 && q.high.h === 648,
    '低 ' + q.low.w + '×' + q.low.h + ' / 高 ' + q.high.w + '×' + q.high.h);

  // ---- 10. 无错误 ----
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
