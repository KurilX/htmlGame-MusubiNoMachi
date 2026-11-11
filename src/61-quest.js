/* 61-quest.js — 任务运行时
 */
(function (G) {
  'use strict';

  var Q = G.quest = {};

  Q.state = {
    active: {},     // id -> { steps: [done,bool...] }
    done: {}        // id -> true
  };

  Q.init = function () {
    Q.state = { active: {}, done: {} };
  };

  Q.start = function (id) {
    var def = G.DATA.QUESTS[id];
    if (!def || Q.state.active[id] || Q.state.done[id]) return false;
    Q.state.active[id] = {
      id: id,
      steps: def.steps.map(function () { return false; }),
      collectProgress: {}
    };
    G.ui.toast('接受任务：' + def.title, 2200);
    G.bus.emit('quest:started', id);
    return true;
  };

  Q.current = function () {
    for (var id in Q.state.active) return G.DATA.QUESTS[id];
    return null;
  };

  Q.getState = function (id) { return Q.state.active[id]; };

  /** 提交进度 */
  Q.progress = function (id, stepIndex) {
    var st = Q.state.active[id];
    if (!st) return;
    if (st.steps[stepIndex]) return;
    st.steps[stepIndex] = true;
    var def = G.DATA.QUESTS[id];
    G.ui.toast('· ' + def.steps[stepIndex].text, 1600);
    if (Q.isComplete(id)) Q.complete(id);
  };

  Q.isComplete = function (id) {
    var st = Q.state.active[id];
    if (!st) return false;
    for (var i = 0; i < st.steps.length; i++) if (!st.steps[i]) return false;
    return true;
  };

  Q.complete = function (id) {
    var def = G.DATA.QUESTS[id];
    var st = Q.state.active[id];
    if (!st) return;
    delete Q.state.active[id];
    Q.state.done[id] = true;

    G.ui.toast('任务完成：' + def.title, 2600);
    var r = def.rewards || {};
    if (r.exp) G.player.gainExp(r.exp);
    if (r.gold) G.player.state.gold += r.gold;
    if (r.unlockSkill) {
      G.player.state.skillUnlocked[r.unlockSkill] = true;
      var sk = G.DATA.SKILLS[r.unlockSkill];
      G.ui.toast('习得技能：' + (sk ? sk.name : ''), 3000);
      G.bus.emit('sfx', 'skill_unlock');
    }
    G.bus.emit('quest:done', id);
    G.save.save();

    if (def.nextId) Q.start(def.nextId);
  };

  // ---------- 事件钩子 ----------
  Q.onKill = function (defId) {
    for (var id in Q.state.active) {
      var def = G.DATA.QUESTS[id];
      var st = Q.state.active[id];
      for (var i = 0; i < def.steps.length; i++) {
        var step = def.steps[i];
        if (st.steps[i]) continue;
        if (step.type === 'kill' && step.target === defId) {
          st.collectProgress['k' + i] = (st.collectProgress['k' + i] || 0) + 1;
          if (st.collectProgress['k' + i] >= (step.count || 1)) Q.progress(id, i);
        }
      }
    }
  };

  Q.onKnot = function (uid) {
    for (var id in Q.state.active) {
      var def = G.DATA.QUESTS[id];
      var st = Q.state.active[id];
      for (var i = 0; i < def.steps.length; i++) {
        var step = def.steps[i];
        if (st.steps[i]) continue;
        if (step.type === 'knot' && step.target === uid) Q.progress(id, i);
      }
    }
    // 三处结都系上后，触发对白
    var d = G.DATA.DIALOGUES['d_' + uid];
    if (d) {
      G.dlg.start(null, d);
    }
  };

  Q.onTalk = function (npcId) {
    for (var id in Q.state.active) {
      var def = G.DATA.QUESTS[id];
      var st = Q.state.active[id];
      for (var i = 0; i < def.steps.length; i++) {
        var step = def.steps[i];
        if (st.steps[i]) continue;
        if (step.type === 'talk' && step.target === npcId) Q.progress(id, i);
      }
    }
  };

  Q.onCollect = function (itemId, count) {
    for (var id in Q.state.active) {
      var def = G.DATA.QUESTS[id];
      var st = Q.state.active[id];
      for (var i = 0; i < def.steps.length; i++) {
        var step = def.steps[i];
        if (st.steps[i]) continue;
        if (step.type === 'collect' && step.target === itemId) {
          st.collectProgress['c' + i] = count;
          if (count >= (step.count || 1)) Q.progress(id, i);
        }
      }
    }
  };

  Q.onReach = function (pointId) {
    for (var id in Q.state.active) {
      var def = G.DATA.QUESTS[id];
      var st = Q.state.active[id];
      for (var i = 0; i < def.steps.length; i++) {
        var step = def.steps[i];
        if (st.steps[i]) continue;
        if (step.type === 'reach' && step.target === pointId) Q.progress(id, i);
      }
    }
  };

})(window.G = window.G || {});
