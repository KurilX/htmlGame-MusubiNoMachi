/* 70-ui.js — DOM 覆盖层 UI
 *
 * 所有文字 UI 用 DOM 叠在 canvas 上（不参与像素化），字永远清楚。
 */
(function (G) {
  'use strict';

  var U = G.ui = {};

  U.root = null;
  U.damageLayer = null;
  U.toastLayer = null;
  U.hpFill = null;
  U.expFill = null;
  U.levelText = null;
  U.goldText = null;
  U.clockText = null;
  U.skillEls = [];
  U.toastTimer = 0;
  U.panels = {};

  // =====================================================================
  // 构建
  // =====================================================================
  U.init = function () {
    var root = document.getElementById('ui');
    U.root = root;

    // ---- 左上：状态 ----
    var status = G.dom.el('div', 'panel status', root);

    // 等级 + 名字
    var head = G.dom.el('div', 'status-head', status);
    U.levelText = G.dom.el('span', 'lv', head, 'Lv.1');
    G.dom.el('span', 'name', head, '旅人');

    // HP 条
    var hpWrap = G.dom.el('div', 'bar hp', status);
    var hpBg = G.dom.el('div', 'bar-bg', hpWrap);
    U.hpFill = G.dom.el('div', 'bar-fill', hpWrap);
    U.hpText = G.dom.el('div', 'bar-text', hpWrap, '100 / 100');

    // EXP 条
    var expWrap = G.dom.el('div', 'bar exp', status);
    G.dom.el('div', 'bar-bg', expWrap);
    U.expFill = G.dom.el('div', 'bar-fill', expWrap);

    // 金币 + 时间
    var meta = G.dom.el('div', 'status-meta', status);
    U.goldText = G.dom.el('span', 'gold', meta, '0 文');
    U.clockText = G.dom.el('span', 'clock', meta, '06:00');

    // ---- 右上：任务追踪（常驻，显示"现在该做什么"）----
    // 新手引导的核心：不用打开任何面板就知道下一步该干什么。
    U.trackerBox = G.dom.el('div', 'quest-tracker', root);
    U.trackerBox.style.display = 'none';
    U.trackerTitle = G.dom.el('div', 'qt-title', U.trackerBox, '');
    U.trackerStep = G.dom.el('div', 'qt-step', U.trackerBox, '');

    // ---- 左下：技能栏 ----
    var bar = G.dom.el('div', 'skillbar', root);
    U.skillBar = bar;
    for (var i = 1; i <= 4; i++) {
      var sk = G.dom.el('div', 'skill', bar);
      sk.dataset.skill = String(i);
      var key = G.dom.el('div', 'skill-key', sk, String(i));
      var nm = G.dom.el('div', 'skill-name', sk, '—');
      var cd = G.dom.el('div', 'skill-cd', sk, '');
      var icon = G.dom.el('div', 'skill-icon', sk, '');
      sk._name = nm; sk._cd = cd; sk._icon = icon;
      U.skillEls.push(sk);
    }
    // 闪避
    var dodgeEl = G.dom.el('div', 'skill dodge', bar);
    G.dom.el('div', 'skill-key', dodgeEl, 'Shift');
    G.dom.el('div', 'skill-name', dodgeEl, '滾');
    dodgeEl._cd = G.dom.el('div', 'skill-cd', dodgeEl, '');
    U.dodgeEl = dodgeEl;

    // ---- 中下：交互提示 ----
    U.prompt = G.dom.el('div', 'prompt', root);
    U.prompt.style.display = 'none';

    // ---- 中上：Boss 血条 ----
    U.bossBar = G.dom.el('div', 'bossbar', root);
    U.bossBar.style.display = 'none';
    U.bossName = G.dom.el('div', 'boss-name', U.bossBar, '');
    var bossBarBg = G.dom.el('div', 'bar-bg', U.bossBar);
    U.bossFill = G.dom.el('div', 'bar-fill', bossBarBg);

    // ---- 右侧：toast ----
    U.toastLayer = G.dom.el('div', 'toasts', root);

    // ---- 伤害数字层（最高层，不拦截点击） ----
    U.damageLayer = G.dom.el('div', 'dmglayer', root);

    // ---- 受伤红闪 ----
    U.hurtVignette = G.dom.el('div', 'hurtvignette', root);

    // ---- 对话框 ----
    U.buildDialog();

    // ---- 面板（背包 / 商店） ----
    U.buildInventoryPanel();
    U.buildShopPanel();
  U.buildQuestPanel();

    // ---- 标题 ----
    U.fadeIn = G.dom.el('div', 'fadein', root);

    U.bindEvents();
  };

  // =====================================================================
  // 面板：背包
  // =====================================================================
  U.buildInventoryPanel = function () {
    var p = G.dom.el('div', 'overlay panel-inv', U.root);
    p.style.display = 'none';
    var head = G.dom.el('div', 'ov-head', p);
    G.dom.el('h2', '', head, '行囊');
    G.dom.el('div', 'hint', head, 'I / Esc 关闭');

    var body = G.dom.el('div', 'ov-body', p);
    var equipCol = G.dom.el('div', 'inv-col equip', body);
    G.dom.el('h3', '', equipCol, '装备');
    U.equipSlots = {};
    ['weapon', 'charm', 'robe'].forEach(function (s) {
      var row = G.dom.el('div', 'equip-slot', equipCol);
      row.dataset.slot = s;
      var label = { weapon: '刀', charm: '护符', robe: '衣装' }[s];
      G.dom.el('div', 'es-label', row, label);
      var box = G.dom.el('div', 'es-box', row, '空');
      U.equipSlots[s] = box;
    });

    var statsCol = G.dom.el('div', 'inv-col stats', body);
    G.dom.el('h3', '', statsCol, '属性');
    U.statList = G.dom.el('div', 'statlist', statsCol);

    var bagCol = G.dom.el('div', 'inv-col bag', body);
    G.dom.el('h3', '', bagCol, '物品');
    U.bagList = G.dom.el('div', 'baglist', bagCol);

    U.panels.inventory = p;
  };

  // =====================================================================
  // 面板：任务日志
  // =====================================================================
  U.buildQuestPanel = function () {
    var p = G.dom.el('div', 'overlay panel-quest', U.root);
    p.style.display = 'none';
    var head = G.dom.el('div', 'ov-head', p);
    G.dom.el('h2', '', head, '手账');
    G.dom.el('div', 'hint', head, 'L / Esc 关闭');

    U.questList = G.dom.el('div', 'questlist', p);
    U.panels.quest = p;
  };

  /** 重绘任务日志 */
  U.renderQuestPanel = function () {
    if (!U.questList || !G.quest) return;
    var box = U.questList;
    box.innerHTML = '';

    var items = G.quest.list();
    if (!items.length) {
      G.dom.el('div', 'quest-empty', box, '现在没有在办的事。去镇上和人多说说话。');
      return;
    }

    items.forEach(function (item) {
      var def = item.def;
      var st = item.st;
      var isMain = (def.chapter || 0) > 0;

      var card = G.dom.el('div', 'quest-card' + (isMain ? ' main' : ' side'), box);

      var titleRow = G.dom.el('div', 'q-title-row', card);
      G.dom.el('span', 'q-tag', titleRow, isMain ? '主线' : '支线');
      G.dom.el('span', 'q-title', titleRow, def.title);

      if (isMain && def.chapter) {
        G.dom.el('span', 'q-chapter', titleRow, '第 ' + def.chapter + ' 章');
      }

      if (def.brief) {
        G.dom.el('div', 'q-brief', card, def.brief);
      }

      // 步骤列表
      var stepsBox = G.dom.el('div', 'q-steps', card);
      for (var i = 0; i < def.steps.length; i++) {
        var step = def.steps[i];
        var done = !!st.steps[i];
        var row = G.dom.el('div', 'q-step' + (done ? ' done' : ''), stepsBox);

        G.dom.el('span', 'q-mark', row, done ? '✓' : '·');

        // 计数类步骤显示进度
        var text = step.text;
        if (step.count > 1) {
          var pkey = (step.type === 'kill') ? ('k' + i) : ('c' + i);
          var cur = st.collectProgress[pkey] || 0;
          text += '  ' + Math.min(cur, step.count) + '/' + step.count;
        }
        G.dom.el('span', 'q-text', row, text);
      }

      // 提示（只在未完成时显示）
      if (def.hint && item.cur >= 0) {
        G.dom.el('div', 'q-hint', card, '▸ ' + def.hint);
      }
    });

    // 主线总进度
    var lines = G.DATA.QUEST_LINES || {};
    for (var key in lines) {
      var lp = G.quest.lineProgress(key);
      if (lp && lp.done > 0 && lp.done < lp.total) {
        G.dom.el('div', 'q-line-progress', box,
          lp.name + ' 主线：' + lp.done + ' / ' + lp.total + ' 章');
      }
    }
  };

  // =====================================================================
  // 面板：商店
  // =====================================================================
  U.buildShopPanel = function () {
    var p = G.dom.el('div', 'overlay panel-shop', U.root);
    p.style.display = 'none';
    var head = G.dom.el('div', 'ov-head', p);
    U.shopTitle = G.dom.el('h2', '', head, '店铺');
    G.dom.el('div', 'hint', head, 'Esc 关闭');

    U.shopGreet = G.dom.el('div', 'shop-greet', p, '');
    var body = G.dom.el('div', 'ov-body', p);
    U.shopList = G.dom.el('div', 'shoplist', body);
    U.panels.shop = p;
  };

  // =====================================================================
  // 对话框
  // =====================================================================
  U.buildDialog = function () {
    var d = G.dom.el('div', 'dialog', U.root);
    d.style.display = 'none';
    U.dialogEl = d;
    U.dialogName = G.dom.el('div', 'dlg-name', d, '');
    U.dialogText = G.dom.el('div', 'dlg-text', d, '');
    U.dialogChoices = G.dom.el('div', 'dlg-choices', d);
    U.dialogHint = G.dom.el('div', 'dlg-hint', d, '▼ 空格 / 点击 继续');
  };

  // =====================================================================
  // 事件绑定
  // =====================================================================
  U.bindEvents = function () {
    G.bus.on('ui:dirty', function () { U.refreshHUD(); });
    G.bus.on('sfx', function (id) { if (G.audio) G.audio.play(id); });
    G.bus.on('player:levelup', function () { U.refreshHUD(); });
    G.bus.on('phase:changed', function () {
      U.refreshHUD();
      if (G.world.isNight()) U.toast('入夜了', 1400);
      else U.toast('天亮了', 1400);
    });
    G.bus.on('day:passed', function () { U.refreshHUD(); });
  };

  // =====================================================================
  // 每帧刷新
  // =====================================================================
  U.update = function (dt) {
    var st = G.player.state;
    if (!st) return;

    // HP / EXP
    var pct = Math.max(0, st.hp / st.maxHp);
    U.hpFill.style.width = (pct * 100).toFixed(1) + '%';
    U.hpFill.style.background = pct > 0.5 ? 'linear-gradient(180deg,#7FB069,#5C8A4A)'
      : (pct > 0.25 ? 'linear-gradient(180deg,#E8C25A,#B89840)'
                    : 'linear-gradient(180deg,#E05A4F,#A8302A)');
    U.hpText.textContent = Math.ceil(st.hp) + ' / ' + Math.ceil(st.maxHp);

    var epct = Math.min(1, st.exp / Math.max(1, st.expNext));
    U.expFill.style.width = (epct * 100).toFixed(1) + '%';

    U.levelText.textContent = 'Lv.' + st.level;
    U.goldText.textContent = st.gold + ' 文';

    // 时钟
    if (G.world) {
      U.clockText.textContent = G.fmt.clock(G.world.timeOfDay) +
        (G.world.isNight() ? ' 🌙' : ' ☀');
    }

    // 技能冷却
    for (var i = 0; i < 4; i++) {
      var el = U.skillEls[i];
      var n = i + 1;
      var def = G.DATA.SKILLS[n];
      var unlocked = st.skillUnlocked[n];
      el.classList.toggle('locked', !unlocked);
      el._name.textContent = unlocked ? def.name : '未习得';
      var cdState = st.skills[n];
      if (cdState && cdState.cd > 0) {
        el._cd.textContent = cdState.cd.toFixed(1);
        el.classList.add('cooling');
        el._cd.style.height = Math.min(100, (cdState.cd / def.cooldown) * 100) + '%';
      } else {
        el._cd.textContent = '';
        el.classList.remove('cooling');
        el._cd.style.height = '0%';
      }
    }
    // 闪避冷却
    var dodgeReady = st.dodge.cd <= 0;
    U.dodgeEl.classList.toggle('cooling', !dodgeReady);
    U.dodgeEl._cd.textContent = dodgeReady ? '' : st.dodge.cd.toFixed(1);

    // 交互提示
    var near = G.world.nearestInteractable(st.x, st.z, 2.4);
    if (near && !U.panels.inventory.style.display.match(/block/) && U.dialogEl.style.display === 'none') {
      U.prompt.style.display = '';
      U.prompt.textContent = U.interactLabel(near);
    } else {
      U.prompt.style.display = 'none';
    }

    // Boss 血条
    var boss = null;
    for (var b = 0; b < G.enemy.list.length; b++) {
      var en = G.enemy.list[b];
      if (en.def.tier === 'boss' && !en.dead) { boss = en; break; }
    }
    if (boss) {
      U.bossBar.style.display = '';
      U.bossName.textContent = boss.def.name;
      U.bossFill.style.width = (boss.hp / boss.maxHp * 100) + '%';
    } else {
      U.bossBar.style.display = 'none';
    }

    // toast 淡出
    if (U.toastLayer.children.length > 4) {
      U.toastLayer.removeChild(U.toastLayer.firstChild);
    }
  };

  U.interactLabel = function (it) {
    switch (it.kind) {
      case 'stele': return 'E　读碑文';
      case 'chest': return 'E　打开宝箱';
      case 'knot': return 'E　触碰结';
      case 'node': return it.nodeType === 'ore' ? 'E　采掘' : 'E　采集';
      case 'shrine': return 'E　参拜（保存）';
      case 'gate': return 'E　进入忘れ緒の社';
      case 'npc': return 'E　交谈';
      default: return 'E　交互';
    }
  };

  // =====================================================================
  // 任务追踪 HUD（常驻显示当前该做什么）
  // =====================================================================
  
  var _trackLastText = null;
  
  U.updateQuestTracker = function () {
    if (!U.trackerBox || !G.quest) return;
    var next = G.quest.nextStep ? G.quest.nextStep() : null;
    var def = G.quest.tracked ? G.quest.tracked() : null;
    
    if (!def || !next) {
      if (_trackLastText !== null) {
        U.trackerBox.style.display = 'none';
        _trackLastText = null;
      }
      return;
    }
    
    var step = next.step;
    var text = step.text;
    if (step.count > 1) {
      text += '  ' + Math.min(next.progress, next.need) + '/' + next.need;
    }
    var full = def.title + '｜' + text;
    if (full === _trackLastText) return;   // 内容没变就不碰 DOM
    _trackLastText = full;
    
    U.trackerBox.style.display = '';
    U.trackerTitle.textContent = def.title;
    U.trackerStep.textContent = text;
  };
  
  U.refreshHUD = function () {
    // 触发一次重绘（低开销）
    if (G.player.state) U.update(0.016);
  };

  // =====================================================================
  // 提示
  // =====================================================================
  // 踩过的坑：连按 E 读碑文会连续弹 4 条完全相同的 toast，糊满右侧。
  // 这里做去重 + 同一内容 1.2 秒内只允许一条。
  U._lastToast = { msg: '', at: 0 };

  U.toast = function (msg, ms) {
    if (!U.toastLayer) {
      U.toastLayer = G.dom.el('div', 'toasts', U.root);
    }
    var now = performance.now();
    if (msg === U._lastToast.msg && now - U._lastToast.at < 1200) {
      return null;   // 重复内容，丢弃
    }
    U._lastToast.msg = msg;
    U._lastToast.at = now;

    var t = G.dom.el('div', 'toast', U.toastLayer, msg);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
      }, 400);
    }, ms || 1500);
    return t;
  };

  U.flashHurt = function () {
    if (!U.hurtVignette) return;
    U.hurtVignette.classList.remove('on');
    // 强制重排以重启动画
    void U.hurtVignette.offsetWidth;
    U.hurtVignette.classList.add('on');
  };

  U.bossPhase = function (e, phase) {
    U.toast(e.def.name + ' 进入了第 ' + (phase + 1) + ' 阶段', 2200);
  };

  U.bossTelegraph = function (e, sec) {
    U.toast('⚠ 結びの神 蓄力中——快躲开！', 1400);
  };

  // =====================================================================
  // 对话
  // =====================================================================
  U.showDialog = function (npc, dialogueId) {
    U.dialogEl.style.display = '';
    U.dialogName.textContent = npc.def.name;
    var dlg = G.DATA.DIALOGUES[dialogueId];
    if (!dlg) {
      U.dialogText.textContent = '……';
      U.dialogChoices.innerHTML = '';
      return;
    }
    G.dlg.start(npc, dlg);
  };

  U.hideDialog = function () {
    U.dialogEl.style.display = 'none';
    U.dialogChoices.innerHTML = '';
  };

  // =====================================================================
  // 面板开关
  // =====================================================================
  U.togglePanel = function (key) {
    var keys = ['inventory', 'shop', 'quest'];
    for (var i = 0; i < keys.length; i++) {
      var p = U.panels[keys[i]];
      if (!p) continue;
      if (keys[i] === key) {
        var on = p.style.display === 'none' || !p.style.display;
        p.style.display = on ? '' : 'none';
        if (on) U.renderPanel(key);
      } else {
        p.style.display = 'none';
      }
    }
  };

  U.closeAllPanels = function () {
    var keys = ['inventory', 'shop', 'quest'];
    for (var i = 0; i < keys.length; i++) {
      if (U.panels[keys[i]]) U.panels[keys[i]].style.display = 'none';
    }
    U.hideDialog();
  };

  U.anyPanelOpen = function () {
    var keys = ['inventory', 'shop', 'quest'];
    for (var i = 0; i < keys.length; i++) {
      var p = U.panels[keys[i]];
      if (p && p.style.display !== 'none') return true;
    }
    return U.dialogEl.style.display !== 'none';
  };

  U.renderPanel = function (key) {
    if (key === 'inventory') U.renderInventory();
    if (key === 'shop') U.renderShop();
    if (key === 'quest') U.renderQuestPanel();
  };

  // =====================================================================
  // 背包渲染
  // =====================================================================
  U.renderInventory = function () {
    var st = G.player.state;

    // 装备位
    ['weapon', 'charm', 'robe'].forEach(function (s) {
      var box = U.equipSlots[s];
      var item = st.equip[s];
      if (!item) {
        box.textContent = '空';
        box.className = 'es-box';
      } else {
        box.textContent = item.name;
        box.className = 'es-box q' + item.quality;
        box.title = U.itemTooltip(item);
      }
    });

    // 属性
    var sl = U.statList;
    sl.innerHTML = '';
    [
      ['攻击', st.atk],
      ['防御', st.def],
      ['生命', Math.ceil(st.hp) + ' / ' + Math.ceil(st.maxHp)],
      ['暴击', (st.crit * 100).toFixed(1) + '%'],
      ['金币', st.gold]
    ].forEach(function (row) {
      var r = G.dom.el('div', 'statrow', sl);
      G.dom.el('span', 'k', r, row[0]);
      G.dom.el('span', 'v', r, String(row[1]));
    });

    // 背包
    var bl = U.bagList;
    bl.innerHTML = '';
    if (st.bag.length === 0) {
      G.dom.el('div', 'empty', bl, '空');
      return;
    }
    st.bag.forEach(function (item) {
      var row = G.dom.el('div', 'bagitem q' + (item.quality || 1), bl);
      var name = G.dom.el('span', 'bi-name', row,
        item.name + (item.qty > 1 ? ' ×' + item.qty : ''));
      if (item.kind === 'gear') {
        G.dom.el('span', 'bi-tag', row, '装备');
        row.addEventListener('click', function () {
          if (G.inv.equip(item.uid)) {
            U.renderInventory();
            U.toast('装备了 ' + item.name, 1200);
          }
        });
      } else if (item.kind === 'consumable') {
        G.dom.el('span', 'bi-tag', row, '使用');
        row.addEventListener('click', function () {
          G.inv.useConsumable(item.uid);
          U.renderInventory();
        });
      } else {
        G.dom.el('span', 'bi-tag', row, '素材');
      }
      row.title = U.itemTooltip(item);
    });
  };

  U.itemTooltip = function (item) {
    var lines = [];
    var qn = G.DATA.QUALITY_NAMES[(item.quality || 1) - 1];
    if (item.kind === 'gear') lines.push('[' + qn + '] ' + item.name);
    else lines.push(item.name);
    if (item.baseAtk) lines.push('攻击 +' + item.baseAtk);
    if (item.baseDef) lines.push('防御 +' + item.baseDef);
    if (item.affixes) {
      item.affixes.forEach(function (a) {
        var txt = a.fmt.replace('{v}', a.value).replace('{p}', (a.value * 100).toFixed(1));
        lines.push('  ' + a.name + '：' + txt);
      });
    }
    if (item.desc) lines.push('', item.desc);
    if (item.heal) lines.push('恢复 ' + item.heal + ' 生命');
    return lines.join('\n');
  };

  // =====================================================================
  // 商店渲染
  // =====================================================================
  U.openShop = function (shopId) {
    U.currentShop = G.DATA.SHOPS[shopId];
    U.panels.shop.style.display = '';
    U.shopTitle.textContent = U.currentShop.name;
    U.shopGreet.textContent = U.currentShop.greeting;
    U.renderShop();
  };

  U.renderShop = function () {
    var shop = U.currentShop;
    if (!shop) return;
    var st = G.player.state;
    var list = U.shopList;
    list.innerHTML = '';

    G.dom.el('div', 'shop-gold', list, '所持金：' + st.gold + ' 文');

    // 商品
    shop.stock.forEach(function (defId) {
      var def = G.DATA.ITEMS[defId];
      if (!def) return;
      var price = def.value;
      var row = G.dom.el('div', 'shoprow', list);
      G.dom.el('span', 'sr-name', row, def.name);
      G.dom.el('span', 'sr-price', row, price + ' 文');
      var btn = G.dom.el('button', 'sr-buy', row, '买入');
      btn.addEventListener('click', function () {
        if (st.gold < price) { U.toast('金币不足', 1200); return; }
        st.gold -= price;
        var item = G.inv.instantiate(defId);
        if (item) G.inv.add(item, 1);
        G.bus.emit('sfx', 'buy');
        U.toast('买入了 ' + def.name, 1200);
        U.renderShop();
        G.bus.emit('ui:dirty');
      });
    });

    // 重铸
    if (shop.reforge) {
      G.dom.el('div', 'shop-sep', list, '');
      G.dom.el('div', 'shop-h', list, '词条重铸（赌博）');
      G.dom.el('div', 'shop-note', list, '花金币重掷一件装备的全部词条。品质越高越贵。');

      var candidates = [];
      ['weapon', 'charm', 'robe'].forEach(function (s) {
        if (st.equip[s]) candidates.push(st.equip[s]);
      });
      st.bag.forEach(function (it) { if (it.kind === 'gear') candidates.push(it); });

      if (candidates.length === 0) {
        G.dom.el('div', 'shop-note', list, '（没有可重铸的装备）');
      }
      candidates.slice(0, 8).forEach(function (item) {
        var cost = G.inv.reforgeCost(item);
        var row = G.dom.el('div', 'shoprow reforge q' + item.quality, list);
        var info = G.dom.el('div', 'rf-info', row);
        G.dom.el('span', 'sr-name', info, item.name);
        var afText = (item.affixes || []).map(function (a) {
          return a.fmt.replace('{v}', a.value).replace('{p}', (a.value * 100).toFixed(1));
        }).join(' · ') || '（无词条）';
        G.dom.el('div', 'rf-affixes', info, afText);
        G.dom.el('span', 'sr-price', row, cost + ' 文');
        var btn = G.dom.el('button', 'sr-buy', row, '重铸');
        btn.addEventListener('click', function () {
          var res = G.inv.reforge(item.uid);
          if (res.ok) {
            U.toast('重铸完成！', 1400);
            U.renderShop();
            U.refreshHUD();
          } else {
            U.toast(res.msg, 1600);
          }
        });
      });
    }
  };

})(window.G = window.G || {});
