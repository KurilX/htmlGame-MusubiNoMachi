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
