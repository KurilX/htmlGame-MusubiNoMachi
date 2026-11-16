/* 80-save.js — 存档：3 槽 + 自动存 + JSON 导入导出
 *
 * file:// 下 localStorage 可用但不保证，所以导出/导入是唯一可靠的迁移手段。
 */
(function (G) {
  'use strict';

  var S = G.save = {};

  var PREFIX = 'musubi_save_v1_';
  var META_KEY = 'musubi_meta_v1';

  S.init = function () {
    var meta = S.readMeta();
    if (!meta.current) {
      meta.current = 1;
      S.writeMeta(meta);
    }
    S._meta = meta;
  };

  S.readMeta = function () {
    try {
      var raw = localStorage.getItem(META_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { current: 1, slots: {} };
  };

  S.writeMeta = function (meta) {
    S._meta = meta;
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ }
  };

  S.currentSlot = function () {
    return (S._meta && S._meta.current) || 1;
  };

  S.setSlot = function (n) {
    var meta = S.readMeta();
    meta.current = n;
    S.writeMeta(meta);
    return n;
  };

  // ---------- 序列化 ----------
  S.serialize = function () {
    var st = G.player.state;
    var world = G.world;
    var opened = [], knots = [];
    for (var i = 0; i < world.interactables.length; i++) {
      var it = world.interactables[i];
      if (it.kind === 'chest' && it.opened) opened.push(it.uid);
      if (it.kind === 'pot' && it.broken) opened.push(it.uid);
      if (it.kind === 'knot' && it.done) knots.push(it.uid);
    }

    return {
      version: 1,
      savedAt: Date.now(),
      playedSec: Math.round(G.main ? G.main.elapsed : 0),
      player: {
        name: st.name,
        level: st.level,
        exp: st.exp,
        gold: st.gold,
        hp: Math.ceil(st.hp),
        position: { x: st.x, z: st.z },
        equip: {
          weapon: st.equip.weapon,
          charm: st.equip.charm,
          robe: st.equip.robe
        },
        bag: st.bag,
        skillUnlocked: st.skillUnlocked
      },
      world: {
        timeOfDay: world.timeOfDay,
        dayCount: world.dayCount,
        opened: opened,
        knots: knots
      },
      // 任务状态必须存盘，否则读档后所有主线进度清零
      // （之前完全没存，读档等于任务全部重来）
      quest: (G.quest && G.quest.state) ? {
        active: G.quest.state.active,
        done: G.quest.state.done
      } : null,
      stats: {
        kills: G.main._killCount || 0
      }
    };
  };

  S.deserialize = function (data) {
    if (!data || !data.player) return false;
    var st = G.player.state;
    var p = data.player;
    st.name = p.name || '旅人';
    st.level = p.level || 1;
    st.exp = p.exp || 0;
    st.gold = p.gold || 0;
    if (p.position) { st.x = p.position.x; st.z = p.position.z; }
    if (p.equip) {
      st.equip.weapon = p.equip.weapon || null;
      st.equip.charm = p.equip.charm || null;
      st.equip.robe = p.equip.robe || null;
    }
    if (p.bag) st.bag = p.bag;
    if (p.skillUnlocked) st.skillUnlocked = p.skillUnlocked;
    G.player.recalcStats();
    st.hp = Math.min(st.maxHp, p.hp || st.maxHp);

    if (data.world) {
      if (data.world.timeOfDay != null) G.world.timeOfDay = data.world.timeOfDay;
      if (data.world.dayCount != null) G.world.dayCount = data.world.dayCount;
      (data.world.opened || []).forEach(function (uid) {
        var it = G.world.interactables.find(function (x) { return x.uid === uid; });
        if (it) {
          it.opened = true; it.broken = true;
          if (it.obj) it.obj.visible = false;
        }
      });
      (data.world.knots || []).forEach(function (uid) {
        var it = G.world.interactables.find(function (x) { return x.uid === uid; });
        if (it) it.done = true;
      });
    }

    // 恢复任务状态（与存盘对称）
    if (G.quest && data.quest) {
      G.quest.state.active = data.quest.active || {};
      G.quest.state.done = data.quest.done || {};
      if (G.quest.resetRuntime) G.quest.resetRuntime();
    }
    return true;
  };

  // ---------- 读/写 ----------
  S.save = function (slot) {
    slot = slot || S.currentSlot();
    try {
      var data = S.serialize();
      localStorage.setItem(PREFIX + slot, JSON.stringify(data));
      var meta = S.readMeta();
      meta.slots = meta.slots || {};
      meta.slots[slot] = {
        savedAt: data.savedAt,
        level: data.player.level,
        name: data.player.name
      };
      S.writeMeta(meta);
      return true;
    } catch (e) {
      console.warn('[save] failed', e);
      G.ui.toast('存档失败（浏览器限制）', 2400);
      return false;
    }
  };

  S.load = function (slot) {
    slot = slot || S.currentSlot();
    try {
      var raw = localStorage.getItem(PREFIX + slot);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  };

  S.hasSave = function (slot) {
    try { return !!localStorage.getItem(PREFIX + (slot || S.currentSlot())); }
    catch (e) { return false; }
  };

  /**
   * 槽位摘要（主菜单用）。
   *
   * 只读 localStorage、不碰 G.player / G.world，
   * 所以可以在世界构建完成之前调用 —— 主菜单正是这个场景。
   */
  S.summarize = function (slots) {
    var list = slots || [1, 2, 3];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var slot = list[i];
      var raw = null;
      try { raw = localStorage.getItem(PREFIX + slot); } catch (e) { raw = null; }

      if (!raw) {
        out.push({ slot: slot, exists: false });
        continue;
      }

      var d = null;
      try { d = JSON.parse(raw); } catch (e) { d = null; }
      if (!d || !d.player) {
        // 存档损坏：仍视为"存在"，但标出来让玩家知道
        out.push({ slot: slot, exists: true, corrupt: true });
        continue;
      }

      // 位置名：按坐标判断在哪个地区
      var place = '旅の途中';
      var px = d.player.position ? d.player.position.x : 0;
      var pz = d.player.position ? d.player.position.z : 0;
      if (G.terrain && G.terrain.regionAt) {
        var region = G.terrain.regionAt(px, pz);
        var names = { town: '結ノ町', field: '霞ヶ原', mountain: '神山', harbor: '湊町', beach: '渚' };
        place = names[region] || place;
      }

      // 当前主线标题
      var questTitle = '';
      if (d.quest && d.quest.active) {
        for (var qid in d.quest.active) {
          var qdef = G.DATA.QUESTS && G.DATA.QUESTS[qid];
          if (qdef) { questTitle = qdef.title; break; }
        }
      }

      out.push({
        slot: slot,
        exists: true,
        corrupt: false,
        level: d.player.level || 1,
        name: d.player.name || '旅人',
        playedSec: d.playedSec || 0,
        savedAt: d.savedAt || 0,
        place: place,
        gold: d.player.gold || 0,
        questTitle: questTitle
      });
    }
    return out;
  };

  /** 有没有任何存档（主菜单判断"继续游戏"是否可点） */
  S.anySave = function (slots) {
    var list = slots || [1, 2, 3];
    for (var i = 0; i < list.length; i++) {
      if (S.hasSave(list[i])) return true;
    }
    return false;
  };

  /** 最近一次保存的槽位（"继续游戏"默认选它） */
  S.latestSlot = function (slots) {
    var list = slots || [1, 2, 3];
    var best = null, bestAt = -1;
    for (var i = 0; i < list.length; i++) {
      var raw = null;
      try { raw = localStorage.getItem(PREFIX + list[i]); } catch (e) { raw = null; }
      if (!raw) continue;
      var d = null;
      try { d = JSON.parse(raw); } catch (e) { d = null; }
      var at = d && d.savedAt ? d.savedAt : 0;
      if (at > bestAt) { bestAt = at; best = list[i]; }
    }
    return best;
  };

  // ---------- 导出/导入 ----------
  S.exportJSON = function () {
    var data = S.serialize();
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') + '-' +
      String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    a.href = url;
    a.download = 'musubi-save-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
    G.ui.toast('存档已导出', 1800);
  };

  S.importJSON = function (file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (S.deserialize(data)) {
          G.save.save();
          G.ui.toast('存档已导入', 2000);
        } else {
          G.ui.toast('存档格式不对', 2000);
        }
      } catch (e) {
        G.ui.toast('读不出这个文件', 2000);
      }
    };
    reader.readAsText(file);
  };

  S.clearSlot = function (slot) {
    try {
      localStorage.removeItem(PREFIX + (slot || S.currentSlot()));
      var meta = S.readMeta();
      if (meta.slots) delete meta.slots[slot];
      S.writeMeta(meta);
    } catch (e) { /* ignore */ }
  };

})(window.G = window.G || {});
