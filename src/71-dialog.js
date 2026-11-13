/* 71-dialog.js — 对话运行时
 */
(function (G) {
  'use strict';

  var D = G.dlg = {};

  D.active = false;
  D.npc = null;
  D.data = null;
  D.lineIndex = 0;
  D.waitingChoice = false;
  D.openShopAfter = false;

  D.init = function () { };

  /**
   * 开始一段对话。
   * @param {object} npc 世界里的 NPC 对象
   * @param {object} dlgData G.DATA.DIALOGUES[...] 的数据
   * @param {boolean} shopAfter 结束对话后是否直接开店
   */
  D.start = function (npc, dlgData, shopAfter) {
    if (!dlgData) return;
    D.active = true;
    D.npc = npc;
    D.data = dlgData;
    D.lineIndex = 0;
    D.waitingChoice = false;
    D.openShopAfter = !!shopAfter;

    // 面向玩家
    if (npc && G.player.state) {
      npc.facing = Math.atan2(G.player.state.x - npc.x, G.player.state.z - npc.z);
    }

    G.ui.dialogEl.style.display = '';
    G.ui.dialogName.textContent = dlgData.speaker || (npc ? npc.def.name : '');
    G.ui.dialogChoices.innerHTML = '';
    D.showLine();
  };

  D.showLine = function () {
    var lines = D.data.lines || [];
    if (D.lineIndex >= lines.length) {
      D.showChoices();
      return;
    }
    G.ui.dialogText.textContent = lines[D.lineIndex];
    G.ui.dialogHint.style.display = '';
  };

  /** 点击/空格推进 */
  D.advance = function () {
    if (!D.active) return;
    if (D.waitingChoice) return;   // 选项状态下不能跳过

    var lines = D.data.lines || [];
    D.lineIndex++;
    if (D.lineIndex >= lines.length) {
      D.showChoices();
    } else {
      D.showLine();
    }
  };

  D.showChoices = function () {
    var choices = D.data.choices;

    if (!choices || choices.length === 0) {
      // 无选项：直接结束
      D.end();
      return;
    }

    D.waitingChoice = true;
    G.ui.dialogHint.style.display = 'none';
    var box = G.ui.dialogChoices;
    box.innerHTML = '';
    choices.forEach(function (c, i) {
      var b = G.dom.el('button', 'dlg-choice', box, c.text);
      b.addEventListener('click', function () {
        D.choose(c);
      });
    });
  };

  D.choose = function (choice) {
    D.waitingChoice = false;
    G.ui.dialogChoices.innerHTML = '';

    switch (choice.action) {
      case 'shop':
        D.end(true, choice.shopId);
        break;
      case 'goto':
        var next = G.DATA.DIALOGUES[choice.next];
        if (next) {
          D.data = next;
          D.lineIndex = 0;
          G.ui.dialogName.textContent = next.speaker || '';
          D.showLine();
        } else {
          D.end();
        }
        break;
      case 'close':
      default:
        D.end();
        break;
    }
  };

  D.end = function (skipShop, shopId) {
    D.active = false;
    var npc = D.npc;
    var data = D.data;
    D.npc = null;
    D.data = null;
    D.waitingChoice = false;
    G.ui.hideDialog();

    // 回调
    if (data && data.onEnd) {
      try { data.onEnd(); } catch (e) { console.error(e); }
    }

    // 任务对话完成（推进 talk 类型步骤）
    if (npc && G.quest) G.quest.onTalk(npc.def.id);

    // 自动派发该 NPC 的任务。
    // 放在 onTalk 之后：先结算"回报"，再给新任务，
    // 这样交任务和接下一步可以在同一次对话里完成。
    if (npc && G.quest && G.quest.offerFromNpc) {
      G.quest.offerFromNpc(npc.def.id);
    }

    // 开店
    if (skipShop) {
      var sid = shopId || (npc && npc.def.shop);
      if (sid) G.ui.openShop(sid);
    }
  };

  /** 强制关闭（Esc） */
  D.close = function () {
    if (!D.active) return;
    D.active = false;
    D.npc = null;
    D.data = null;
    D.waitingChoice = false;
    G.ui.hideDialog();
  };

  // 点击对话框推进
  document.addEventListener('click', function (e) {
    if (!D.active) return;
    if (e.target.closest && e.target.closest('.dlg-choice')) return;
    if (e.target.closest && e.target.closest('.dialog')) {
      D.advance();
    }
  });

})(window.G = window.G || {});
