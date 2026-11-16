/* 05-menu.js — 主菜单与存档子菜单
 *
 * 【为什么需要】
 * 之前游戏一加载就直接进场景：`G.boot()` 一次性做完全部初始化，
 * 没有中间态。想改设置、想换存档、想看还有没有别的存档，都没有入口。
 *
 * 【启动拆分】
 *   G.bootShell()  渲染器 + 相机 + 输入 + 音频 + 主菜单   ← 立刻可用
 *   G.startGame()  构建世界 + 玩家 + UI + 开场          ← 点菜单之后才跑
 *
 * 这样点「设置」不必等 world.build()（实测 966ms），
 * 存档操作也不依赖世界。
 *
 * 【层级】
 *   main          主菜单：继续 / 新游戏 / 设置 / 联网（占位）
 *   slots-new     新游戏：选槽位（已有存档会警告覆盖）
 *   slots-cont    继续游戏：选槽位（显示等级/位置/时长/时间）
 *   settings      设置：音量、渲染缩放、存档管理、导出导入
 */
(function (G) {
  'use strict';

  var MENU = G.menu = {};

  MENU.root = null;        // 菜单容器
  MENU.view = 'main';      // 当前视图
  MENU.visible = false;
  MENU.enteredGame = false;

  var SLOTS = [1, 2, 3];

  // =====================================================================
  // 构建 DOM
  // =====================================================================
  MENU.build = function () {
    if (MENU.root) return;

    var root = G.dom.el('div', 'menu-root', document.body);
    MENU.root = root;

    // 背景：半透明遮罩 + 标题
    var veil = G.dom.el('div', 'menu-veil', root);
    var panel = G.dom.el('div', 'menu-panel', root);
    MENU.panel = panel;

    // 标题区
    var head = G.dom.el('div', 'menu-head', panel);
    G.dom.el('div', 'menu-title', head, '結ノ町');
    G.dom.el('div', 'menu-sub', head, 'むすびのまち');

    // 内容区（视图切换时重绘）
    MENU.body = G.dom.el('div', 'menu-body', panel);

    // 底部提示
    G.dom.el('div', 'menu-foot', panel, 'Esc 返回　↑↓ 选择　Enter 确认');

    MENU.view = 'main';
    MENU.render();
  };

  // =====================================================================
  // 视图切换
  // =====================================================================
  MENU.go = function (view) {
    MENU.view = view;
    MENU.render();
  };

  MENU.render = function () {
    if (!MENU.body) return;
    var body = MENU.body;
    body.innerHTML = '';

    if (MENU.view === 'main') MENU._renderMain(body);
    else if (MENU.view === 'slots-new') MENU._renderSlots(body, 'new');
    else if (MENU.view === 'slots-cont') MENU._renderSlots(body, 'cont');
    else if (MENU.view === 'settings') MENU._renderSettings(body);

    MENU._bindKeyboard();
  };

  // ---------- 视图：主菜单 ----------
  MENU._renderMain = function (body) {
    var box = G.dom.el('div', 'menu-actions', body);

    var hasSave = G.save && G.save.anySave && G.save.anySave(SLOTS);

    // 继续游戏
    var contBtn = MENU._button(box, '继续游戏', function () {
      MENU.go('slots-cont');
    }, {
      // 没有任何存档时禁用，并说明原因
      disabled: !hasSave,
      hint: hasSave ? '' : '还没有存档'
    });
    MENU.contBtn = contBtn;

    // 开始新游戏
    MENU._button(box, '开始新游戏', function () {
      MENU.go('slots-new');
    });

    // 联网游戏（占位）
    var online = MENU._button(box, '联网游戏', function () {
      G.ui.toast('联网功能还在做，先单机玩吧', 2600);
    }, { disabled: true, badge: '未开放' });
    MENU.onlineBtn = online;

    // 设置
    MENU._button(box, '设置', function () {
      MENU.go('settings');
    });

    // 版本号
    G.dom.el('div', 'menu-version', body, 'v' + (G.VERSION || '0.0') + '　单文件离线版');
  };

  // ---------- 视图：槽位 ----------
  MENU._renderSlots = function (body, mode) {
    var back = G.dom.el('div', 'menu-back', body, '← 返回');
    back.onclick = function () { MENU.go('main'); };
    back.style.cursor = 'pointer';

    var title = mode === 'new' ? '选择存档位置（新游戏）' : '选择要读取的存档';
    G.dom.el('div', 'menu-h', body, title);

    var list = (G.save && G.save.summarize) ? G.save.summarize(SLOTS) : [];
    var wrap = G.dom.el('div', 'slot-list', body);

    list.forEach(function (info) {
      var card = G.dom.el('div', 'slot-card', wrap);
      var head = G.dom.el('div', 'slot-head', card);
      G.dom.el('span', 'slot-no', head, '存档 ' + info.slot);

      if (!info.exists) {
        G.dom.el('span', 'slot-empty', head, '空');
        G.dom.el('div', 'slot-hint', card, mode === 'new' ? '在这里开始新的旅程' : '没有存档');
        if (mode === 'new') {
          MENU._makeClickable(card, function () { MENU._startNew(info.slot); });
        } else {
          card.classList.add('disabled');
        }
        return;
      }

      if (info.corrupt) {
        G.dom.el('span', 'slot-corrupt', head, '存档损坏');
        G.dom.el('div', 'slot-hint', card, '这个槽位的数据读不出来，可以覆盖它');
        if (mode === 'new') {
          MENU._makeClickable(card, function () { MENU._startNew(info.slot); });
        } else {
          card.classList.add('disabled');
        }
        return;
      }

      // 有存档：显示摘要
      G.dom.el('span', 'slot-lv', head, 'Lv.' + info.level);

      var meta = G.dom.el('div', 'slot-meta', card);
      G.dom.el('div', '', meta, info.place + (info.questTitle ? '　·　' + info.questTitle : ''));
      G.dom.el('div', 'slot-time', meta,
        MENU._fmtDuration(info.playedSec) + '　·　' + MENU._fmtDate(info.savedAt) +
        '　·　' + info.gold + ' 文');

      if (mode === 'new') {
        // 新游戏时已有存档：必须警告会覆盖
        G.dom.el('div', 'slot-warn', card, '⚠ 在这里开始新游戏会覆盖这个存档');
        MENU._makeClickable(card, function () {
          MENU._confirmOverwrite(info.slot, card);
        });
      } else {
        MENU._makeClickable(card, function () { MENU._continueGame(info.slot); });
      }
    });
  };

  /** 覆盖确认：把卡片就地换成"确定要覆盖吗" */
  MENU._confirmOverwrite = function (slot, card) {
    if (card.dataset.confirming === '1') return;
    card.dataset.confirming = '1';

    var bar = G.dom.el('div', 'slot-confirm', card);
    G.dom.el('div', 'slot-confirm-q', bar, '确定覆盖存档 ' + slot + ' 吗？');

    var row = G.dom.el('div', 'slot-confirm-row', bar);

    var yes = G.dom.el('button', 'btn-danger', row, '确定覆盖');
    yes.onclick = function (e) {
      e.stopPropagation();
      MENU._startNew(slot, true);
    };

    var no = G.dom.el('button', 'btn-ghost', row, '取消');
    no.onclick = function (e) {
      e.stopPropagation();
      delete card.dataset.confirming;
      bar.parentNode.removeChild(bar);
    };
  };

  // ---------- 视图：设置 ----------
  MENU._renderSettings = function (body) {
    var back = G.dom.el('div', 'menu-back', body, '← 返回');
    back.onclick = function () { MENU.go('main'); };
    back.style.cursor = 'pointer';

    G.dom.el('div', 'menu-h', body, '设置');

    // ---- 音量 ----
    var volRow = G.dom.el('div', 'set-row', body);
    G.dom.el('div', 'set-label', volRow, '音量');
    var vol = G.dom.el('input', 'set-range', volRow);
    vol.type = 'range';
    vol.min = '0'; vol.max = '100'; vol.step = '5';
    vol.value = String(Math.round((MENU._getVol()) * 100));
    var volNum = G.dom.el('span', 'set-val', volRow, vol.value + '%');
    vol.oninput = function () {
      var v = parseInt(vol.value, 10) / 100;
      MENU._setVol(v);
      volNum.textContent = vol.value + '%';
    };

    // ---- 渲染缩放（画质） ----
    var qRow = G.dom.el('div', 'set-row', body);
    G.dom.el('div', 'set-label', qRow, '画质');
    var qSel = G.dom.el('select', 'set-select', qRow);
    [['high', '高（1152×648）'], ['mid', '中（864×486）'], ['low', '低（640×360）']].forEach(function (o) {
      var opt = G.dom.el('option', '', qSel, o[1]);
      opt.value = o[0];
    });
    qSel.value = MENU._getQuality();
    qSel.onchange = function () {
      MENU._setQuality(qSel.value);
      G.ui.toast('画质已设置，重新进入游戏后生效', 2600);
    };

    // 画质说明：为什么需要重进
    G.dom.el('div', 'set-note', body,
      '画质依赖离屏渲染缓冲的尺寸，切换后需要重新进入游戏才会重建。');

    // ---- 存档管理 ----
    // 备份按钮并在同一区，避免多占一屏高度
    var mgrHead = G.dom.el('div', 'mgr-head', body);
    G.dom.el('div', 'menu-h2', mgrHead, '存档管理');
    var bkRow = G.dom.el('div', 'mgr-actions', mgrHead);

    var exp = G.dom.el('button', 'btn-ghost btn-sm', bkRow, '导出');
    exp.onclick = function () {
      if (!MENU.enteredGame) {
        G.ui.toast('进入游戏后才能导出', 2200);
        return;
      }
      if (G.save.exportJSON) G.save.exportJSON();
    };

    var imp = G.dom.el('button', 'btn-ghost btn-sm', bkRow, '导入');
    imp.onclick = function () {
      if (!MENU.enteredGame) {
        G.ui.toast('进入游戏后才能导入', 2200);
        return;
      }
      if (G.save.importJSON) G.save.importJSON();
    };

    var mgr = G.dom.el('div', 'save-mgr', body);
    var list = (G.save && G.save.summarize) ? G.save.summarize(SLOTS) : [];

    list.forEach(function (info) {
      var row = G.dom.el('div', 'save-row', mgr);
      G.dom.el('span', 'save-row-name', row, '存档 ' + info.slot);
      var desc = info.exists
        ? (info.corrupt ? '损坏' : 'Lv.' + info.level + '　' + info.place)
        : '空';
      G.dom.el('span', 'save-row-desc', row, desc);

      if (info.exists) {
        var del = G.dom.el('button', 'btn-ghost btn-sm', row, '删除');
        del.onclick = function () {
          if (del.dataset.armed === '1') {
            G.save.clearSlot(info.slot);
            G.ui.toast('已删除存档 ' + info.slot, 2000);
            MENU.render();
          } else {
            del.dataset.armed = '1';
            del.textContent = '再点确认';
            setTimeout(function () {
              if (del.parentNode) {
                delete del.dataset.armed;
                del.textContent = '删除';
              }
            }, 3000);
          }
        };
      }
    });
  };

  // =====================================================================
  // 动作
  // =====================================================================

  MENU._startNew = function (slot, confirmed) {
    if (!confirmed && G.save.hasSave(slot)) {
      // 理论上走不到这里（卡片已被 _confirmOverwrite 接管），保底
      return;
    }
    G.save.setSlot(slot);
    G.save.clearSlot(slot);
    MENU.hide();
    G.startGame({ slot: slot, isNew: true });
  };

  MENU._continueGame = function (slot) {
    var data = G.save.load(slot);
    if (!data) {
      G.ui.toast('这个存档读不出来', 2400);
      return;
    }
    G.save.setSlot(slot);
    MENU.hide();
    G.startGame({ slot: slot, isNew: false, data: data });
  };

  /** 从游戏内返回主菜单 */
  MENU.showFromGame = function () {
    if (!MENU.enteredGame) {
      MENU.show();
      return;
    }
    // 自动存档再退出
    try {
      if (G.save && G.player && G.player.state) {
        G.save.save(G.save.currentSlot());
      }
    } catch (e) { /* ignore */ }

    // 停主循环、清场景
    if (G.main && G.main.stop) G.main.stop();
    MENU.enteredGame = false;
    MENU.show();
  };

  // =====================================================================
  // 显示 / 隐藏
  // =====================================================================
  MENU.show = function () {
    MENU.build();
    MENU.visible = true;
    MENU.root.style.display = '';
    MENU.view = 'main';
    MENU.render();

    // 菜单打开时隐藏游戏 HUD，避免两层 UI 叠在一起
    var ui = document.getElementById('ui');
    if (ui) ui.style.display = 'none';

    // 菜单里不响应游戏输入
    if (G.input) G.input.setEnabled && G.input.setEnabled(false);
  };

  MENU.hide = function () {
    if (!MENU.root) return;
    MENU.visible = false;
    MENU.root.style.display = 'none';

    var ui = document.getElementById('ui');
    if (ui) ui.style.display = '';

    if (G.input) G.input.setEnabled && G.input.setEnabled(true);
  };

  // =====================================================================
  // 键盘导航（上下选择、Enter 确认、Esc 返回）
  // =====================================================================
  var _keyHandler = null;

  MENU._bindKeyboard = function () {
    if (_keyHandler) document.removeEventListener('keydown', _keyHandler, true);

    _keyHandler = function (e) {
      if (!MENU.visible) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (MENU.view !== 'main') MENU.go('main');
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        MENU._moveFocus(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (e.key === 'Enter') {
        var focused = MENU.body ? MENU.body.querySelector('.focused') : null;
        if (focused) {
          e.preventDefault();
          e.stopPropagation();
          focused.click();
        }
      }
    };

    document.addEventListener('keydown', _keyHandler, true);
  };

  MENU._moveFocus = function (dir) {
    if (!MENU.body) return;
    var items = Array.prototype.slice.call(
      MENU.body.querySelectorAll('.menu-btn:not(.disabled), .slot-card:not(.disabled)')
    );
    if (!items.length) return;

    var cur = items.findIndex(function (el) { return el.classList.contains('focused'); });
    var next = cur + dir;
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;

    items.forEach(function (el) { el.classList.remove('focused'); });
    items[next].classList.add('focused');
    if (items[next].scrollIntoView) items[next].scrollIntoView({ block: 'nearest' });
  };

  // =====================================================================
  // 小工具
  // =====================================================================

  /** 造一个菜单按钮 */
  MENU._button = function (parent, label, onClick, opt) {
    opt = opt || {};
    var btn = G.dom.el('div', 'menu-btn' + (opt.disabled ? ' disabled' : ''), parent);

    var txt = G.dom.el('span', 'menu-btn-label', btn, label);
    if (opt.badge) G.dom.el('span', 'menu-badge', btn, opt.badge);
    if (opt.hint) G.dom.el('span', 'menu-btn-hint', btn, opt.hint);

    if (!opt.disabled) {
      btn.onclick = onClick;
      // 鼠标移入时同步焦点，键盘和鼠标不打架
      btn.onmouseenter = function () {
        var all = MENU.body.querySelectorAll('.menu-btn, .slot-card');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('focused');
        btn.classList.add('focused');
      };
    }
    return btn;
  };

  /** 让一个非 button 元素可点击 + 可键盘聚焦 */
  MENU._makeClickable = function (el, onClick) {
    el.style.cursor = 'pointer';
    el.onclick = onClick;
    el.onmouseenter = function () {
      var all = MENU.body.querySelectorAll('.menu-btn, .slot-card');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('focused');
      el.classList.add('focused');
    };
  };

  MENU._fmtDuration = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分钟';
    return sec + ' 秒';
  };

  MENU._fmtDate = function (ms) {
    if (!ms) return '未知时间';
    var d = new Date(ms);
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  // ---- 设置项的持久化 ----
  var LS_VOL = 'musubi_vol';
  var LS_Q = 'musubi_quality';

  MENU._getVol = function () {
    var v = null;
    try { v = localStorage.getItem(LS_VOL); } catch (e) {}
    return v == null ? 0.7 : parseFloat(v);
  };
  MENU._setVol = function (v) {
    try { localStorage.setItem(LS_VOL, String(v)); } catch (e) {}
    if (G.audio && G.audio.setVolume) G.audio.setVolume(v);
    else if (G.audio && G.audio.master) G.audio.master.gain.value = v;
  };

  MENU._getQuality = function () {
    var v = null;
    try { v = localStorage.getItem(LS_Q); } catch (e) {}
    return v || 'high';
  };
  MENU._setQuality = function (q) {
    try { localStorage.setItem(LS_Q, q); } catch (e) {}
  };

  /** 画质 -> 内部分辨率 */
  MENU.qualitySize = function () {
    var q = MENU._getQuality();
    if (q === 'low') return { w: 640, h: 360 };
    if (q === 'mid') return { w: 864, h: 486 };
    return { w: 1152, h: 648 };
  };

  // =====================================================================
  // 自动化测试入口
  // =====================================================================
  //
  // ?autostart=1       跳过菜单，新建/读取默认槽位直接进游戏
  // ?autostart=1&slot=2  指定槽位
  //
  // 【为什么需要】9 个既有验收脚本都假设"加载完即在场景里"。
  // 主菜单会打断它们。与其让每个脚本都去点一遍菜单，
  // 不如给一个统一的跳过入口；菜单本身的行为由 verify-menu.js 覆盖。
  MENU.parseAutostart = function () {
    var q = null;
    try { q = new URLSearchParams(window.location.search); } catch (e) { return null; }
    if (!q) return null;

    var auto = q.get('autostart');
    if (auto !== '1' && auto !== 'true') return null;

    var slot = parseInt(q.get('slot') || '', 10);
    if (!isFinite(slot) || slot < 1 || slot > 3) {
      // 没指定槽位：有存档就读最近的，没有就新建 1 号
      var latest = G.save.latestSlot(SLOTS);
      slot = latest || 1;
      if (G.save.hasSave(slot)) {
        var d = G.save.load(slot);
        return { slot: slot, isNew: false, data: d };
      }
      return { slot: slot, isNew: true };
    }

    if (G.save.hasSave(slot)) {
      return { slot: slot, isNew: false, data: G.save.load(slot) };
    }
    return { slot: slot, isNew: true };
  };

})(window.G = window.G || {});
