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
        // boss 步骤：击杀指定的 Boss（数量固定 1）
        if (step.type === 'boss' && step.target === defId) {
          Q.progress(id, i);
        }
      }
    }
  };

  /**
   * 取当前应追踪的任务（用于 HUD 与引导）。
   * 优先返回主线，其次支线。
   */
  Q.tracked = function () {
    var main = null, side = null;
    for (var id in Q.state.active) {
      var def = G.DATA.QUESTS[id];
      if (!def) continue;
      if (def.chapter > 0) { if (!main) main = def; }
      else if (!side) side = def;
    }
    return main || side;
  };

  /**
   * 当前任务的下一个未完成步骤（引导用）。
   * @returns {{step:object, index:number, progress:number, need:number}|null}
   */
  Q.nextStep = function () {
    var def = Q.tracked();
    if (!def) return null;
    var st = Q.state.active[def.id];
    if (!st) return null;
    for (var i = 0; i < def.steps.length; i++) {
      if (st.steps[i]) continue;
      var step = def.steps[i];
      var need = step.count || 1;
      var pkey = (step.type === 'kill') ? ('k' + i) : (step.type === 'collect' ? ('c' + i) : null);
      var progress = pkey ? (st.collectProgress[pkey] || 0) : 0;
      return { step: step, index: i, progress: progress, need: need };
    }
    return null;
  };

  /**
   * 任务进度摘要（任务日志 UI 用）。
   * @returns {Array<{def, st, done:boolean[], cur:number}>}
   */
  Q.list = function () {
    var out = [];
    // 先主线后支线，主线按章节排
    var ids = Object.keys(Q.state.active);
    ids.sort(function (a, b) {
      var da = G.DATA.QUESTS[a], db = G.DATA.QUESTS[b];
      if (!da || !db) return 0;
      // 有章节的（主线）排前面
      var ca = da.chapter || 0, cb = db.chapter || 0;
      if ((ca > 0) !== (cb > 0)) return ca > 0 ? -1 : 1;
      return ca - cb;
    });
    ids.forEach(function (id) {
      var def = G.DATA.QUESTS[id];
      var st = Q.state.active[id];
      if (!def || !st) return;
      var cur = -1;
      for (var i = 0; i < st.steps.length; i++) {
        if (!st.steps[i]) { cur = i; break; }
      }
      out.push({ def: def, st: st, cur: cur });
    });
    return out;
  };

  /** 某条主线的完成度（章节 n / 总章节） */
  Q.lineProgress = function (regionKey) {
    var line = G.DATA.QUEST_LINES && G.DATA.QUEST_LINES[regionKey];
    if (!line) return null;
    var doneCount = 0;
    for (var i = 0; i < line.order.length; i++) {
      if (Q.state.done[line.order[i]]) doneCount++;
    }
    return { done: doneCount, total: line.order.length, name: line.name };
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

  // =====================================================================
  // 到达判定（每帧调用，内部节流）
  // =====================================================================
  //
  // 为什么需要单独的轮询：reach 步骤没有"点击"事件可挂，
  // 只能靠距离判定。之前 onReach 只有定义没有任何调用点，
  // 导致主线中所有 reach 步骤永远无法完成（断裂的一环）。
  var reachTimer = 0;
  var REACH_INTERVAL = 0.25;
  var REACH_RADIUS = 4.5;     // 到"到达点"多少距离内算到达
  var reachedOnce = {};       // 已触发过的点（避免重复）

  Q.checkReach = function (dt, player) {
    if (!player) return;
    reachTimer -= dt;
    if (reachTimer > 0) return;
    reachTimer = REACH_INTERVAL;

    // 只在有 reach 步骤时才计算
    var pending = [];
    for (var id in Q.state.active) {
      var def = G.DATA.QUESTS[id];
      var st = Q.state.active[id];
      if (!def || !st) continue;
      for (var i = 0; i < def.steps.length; i++) {
        if (st.steps[i]) continue;
        if (def.steps[i].type === 'reach') pending.push(def.steps[i].target);
      }
    }
    if (!pending.length) return;

    // 用世界里的 gate 位置做判定
    var gates = (G.world.interactables || []).filter(function (it) {
      return it.kind === 'gate';
    });
    for (var g = 0; g < gates.length; g++) {
      var gate = gates[g];
      if (pending.indexOf(gate.uid) < 0) continue;
      if (reachedOnce[gate.uid]) continue;
      var dx = gate.x - player.x, dz = gate.z - player.z;
      if (dx * dx + dz * dz > REACH_RADIUS * REACH_RADIUS) continue;

      reachedOnce[gate.uid] = true;
      Q.onReach(gate.uid);
      // 到达副本门前时，如果任务要求打 Boss，就在这里召唤
      Q.maybeSpawnBoss(gate.uid, gate.x, gate.z);
    }
  };

  // =====================================================================
  // Boss 召唤
  // =====================================================================
  //
  // 任务里有 boss 步骤时，玩家走到对应门前就召唤 Boss。
  // 这是"主线必须包含 Boss 环节"的实现方式——
  // 不需要完整的副本系统，也能让 Boss 战发生。
  var spawnedBosses = {};

  Q.maybeSpawnBoss = function (gateUid, gx, gz) {
    // 找出所有含 boss 步骤的进行中任务
    var bossId = null;
    for (var id in Q.state.active) {
      var def = G.DATA.QUESTS[id];
      var st = Q.state.active[id];
      if (!def || !st) continue;
      for (var i = 0; i < def.steps.length; i++) {
        if (st.steps[i]) continue;
        if (def.steps[i].type === 'boss') { bossId = def.steps[i].target; break; }
      }
      if (bossId) break;
    }
    if (!bossId) return;
    if (spawnedBosses[bossId]) return;
    spawnedBosses[bossId] = true;

    // 在门前一点的位置生成
    var bx = gx;
    var bz = gz - 6;
    var enemy = null;
    try {
      enemy = G.enemy.spawn(bossId, bx, bz, null);
    } catch (e) {
      console.warn('[quest] boss spawn failed', e);
    }
    if (!enemy) { spawnedBosses[bossId] = false; return; }

    // 出场演出
    G.fx.impactRing(bx, bz, 4.0, '#D9A0E8');
    G.fx.levelUp(bx, bz);
    G.ui.toast('—— 什么东西醒了。', 3000);
    G.bus.emit('sfx', 'skill_unlock');
    if (G.camera.shakeAdd) G.camera.shakeAdd(0.7, 0.5);
    Q.activeBoss = enemy;
  };

  /** 当前是否有进行中的 Boss（供 UI 显示 Boss 血条） */
  Q.getActiveBoss = function () {
    if (Q.activeBoss && !Q.activeBoss.dead) return Q.activeBoss;
    return null;
  };

  /** 重置（读档/重开时用） */
  Q.resetRuntime = function () {
    reachTimer = 0;
    reachedOnce = {};
    spawnedBosses = {};
    Q.activeBoss = null;
  };

  // =====================================================================
  // NPC 派发任务
  // =====================================================================
  //
  // 与 NPC 对话时自动判断：
  //   1) 是否有该 NPC 的"回报型"步骤在等着（talk 步骤）——由 onTalk 处理
  //   2) 是否有未接取的、由该 NPC 给的任务 —— 接取第一条
  //
  // 这样加新任务只需写数据，不用改对话脚本。
  Q.offerFromNpc = function (npcId) {
    // 找出所有 giver === npcId、未接也未完成的、并且没有前置任务的
    var candidates = [];
    for (var id in G.DATA.QUESTS) {
      var def = G.DATA.QUESTS[id];
      if (def.giver !== npcId) continue;
      if (Q.state.active[id] || Q.state.done[id]) continue;
      // 有前置任务的，必须前置已完成
      if (def.after && !Q.state.done[def.after]) continue;
      candidates.push(def);
    }
    if (!candidates.length) return null;

    // 主线优先，其次按章节序号
    candidates.sort(function (a, b) {
      var ca = a.chapter || 0, cb = b.chapter || 0;
      if ((ca > 0) !== (cb > 0)) return ca > 0 ? -1 : 1;
      return ca - cb;
    });

    var pick = candidates[0];
    Q.start(pick.id);
    return pick;
  };

  /** 该 NPC 当前是否有话可说（用于 NPC 头顶的提示符） */
  Q.npcHasOffer = function (npcId) {
    for (var id in G.DATA.QUESTS) {
      var def = G.DATA.QUESTS[id];
      if (def.giver !== npcId) continue;
      if (Q.state.active[id] || Q.state.done[id]) continue;
      if (def.after && !Q.state.done[def.after]) continue;
      return true;
    }
    return false;
  };

  /** 主线是否全部完成（用于结局提示） */
  Q.lineCompleted = function (regionKey) {
    var line = G.DATA.QUEST_LINES && G.DATA.QUEST_LINES[regionKey];
    if (!line) return false;
    for (var i = 0; i < line.order.length; i++) {
      if (!Q.state.done[line.order[i]]) return false;
    }
    return true;
  };

})(window.G = window.G || {});
