/* 60-inventory.js — 背包、装备、掉落、重铸
 */
(function (G) {
  'use strict';

  var M = G.M;
  var I = G.inv = {};

  // 简单的整数 UID
  var uidSeq = 1;

  // =====================================================================
  // 装备生成
  // =====================================================================
  /**
   * 随机生成一件装备。
   * @param {string} slot weapon|charm|robe
   * @param {number} qualityFloor 最低品质 1..5
   */
  I.rollGear = function (slot, qualityFloor) {
    var rnd = Math.random;
    var tmpl = G.DATA.GEAR_TEMPLATES[slot];
    if (!tmpl) return null;

    // 品质：越低越常见，但受 floor 限制
    var q = 1;
    var roll = rnd();
    if (roll > 0.97) q = 5;
    else if (roll > 0.88) q = 4;
    else if (roll > 0.68) q = 3;
    else if (roll > 0.30) q = 2;
    else q = 1;
    q = Math.max(q, qualityFloor || 1);

    var mult = G.DATA.QUALITY_MULT[q - 1];
    var baseAtk = Math.round(M.lerp(tmpl.baseAtk[0], tmpl.baseAtk[1], rnd()) * mult);
    var baseDef = Math.round(M.lerp(tmpl.baseDef[0], tmpl.baseDef[1], rnd()) * mult);

    var affixCount = G.DATA.QUALITY_AFFIXES[q - 1];
    var affixes = [];
    var usedStats = {};
    for (var i = 0; i < affixCount; i++) {
      var pool = G.DATA.AFFIXES.filter(function (a) {
        return a.qualityMin <= q && !usedStats[a.stat];
      });
      if (!pool.length) break;
      var pick = G.weighted(pool.map(function (a) { return { weight: a.weight, a: a }; }));
      if (!pick) break;
      var af = pick.a;
      usedStats[af.stat] = true;
      var v = M.lerp(af.min, af.max, Math.pow(rnd(), 0.7)) * (1 + (q - 1) * 0.12);
      if (af.stat === 'crit' || af.stat === 'speed' || af.stat === 'lifesteal') {
        v = Math.round(v * 1000) / 1000;
      } else {
        v = Math.round(v);
      }
      affixes.push({ id: af.id, stat: af.stat, name: af.name, value: v, fmt: af.fmt });
    }

    var name = tmpl.names[Math.floor(rnd() * tmpl.names.length)] +
      G.DATA.GEAR_SUFFIX[Math.floor(rnd() * G.DATA.GEAR_SUFFIX.length)];

    return {
      uid: 'g' + (uidSeq++),
      id: 'gear_roll',
      name: name,
      kind: 'gear',
      slot: slot,
      quality: q,
      baseAtk: baseAtk,
      baseDef: baseDef,
      affixes: affixes,
      value: Math.round((20 + q * 30) * (1 + affixes.length * 0.3)),
      icon: { shape: 'gear', color: G.DATA.QUALITY_COLORS[q - 1] }
    };
  };

  /** 把物品定义实例化（固定物品加 uid） */
  I.instantiate = function (defId, opts) {
    opts = opts || {};
    if (defId === 'gear_roll') {
      var slots = ['weapon', 'charm', 'robe'];
      var slot = opts.slot || slots[Math.floor(Math.random() * slots.length)];
      return I.rollGear(slot, opts.qualityFloor || 1);
    }
    var def = G.DATA.ITEMS[defId];
    if (!def) return null;
    var item = {};
    for (var k in def) item[k] = def[k];
    item.uid = 'i' + (uidSeq++);
    if (item.kind === 'gear') {
      item.affixes = [];
      if (item.affixSlots > 0) {
        // 固定装备也补词缀
        var pool = G.DATA.AFFIXES.filter(function (a) { return a.qualityMin <= item.quality; });
        for (var a = 0; a < item.affixSlots; a++) {
          var p = pool[Math.floor(Math.random() * pool.length)];
          if (!p) break;
          var v = M.lerp(p.min, p.max, Math.random()) * (1 + (item.quality - 1) * 0.12);
          v = (p.stat === 'crit' || p.stat === 'speed' || p.stat === 'lifesteal')
            ? Math.round(v * 1000) / 1000 : Math.round(v);
          item.affixes.push({ id: p.id, stat: p.stat, name: p.name, value: v, fmt: p.fmt });
        }
      }
    }
    if (opts.qty) item.qty = opts.qty;
    return item;
  };

  // =====================================================================
  // 背包操作
  // =====================================================================
  I.add = function (item, qty) {
    if (!item) return false;
    var st = G.player.state;
    var stackable = (item.kind === 'consumable' || item.kind === 'material');

    if (stackable) {
      for (var i = 0; i < st.bag.length; i++) {
        var b = st.bag[i];
        if (b.id === item.id && b.kind === item.kind) {
          var limit = item.stack || 99;
          var add = qty || 1;
          if (b.qty + add <= limit) {
            b.qty += add;
            return true;
          }
        }
      }
    }

    var clone = {};
    for (var k in item) clone[k] = item[k];
    clone.qty = qty || 1;
    if (st.bag.length >= 40) {
      G.ui.toast('背包满了');
      return false;
    }
    st.bag.push(clone);
    return true;
  };

  I.remove = function (uid, qty) {
    var st = G.player.state;
    for (var i = 0; i < st.bag.length; i++) {
      if (st.bag[i].uid === uid) {
        var n = qty || 1;
        st.bag[i].qty -= n;
        if (st.bag[i].qty <= 0) st.bag.splice(i, 1);
        return true;
      }
    }
    return false;
  };

  /** 装备/卸下 */
  I.equip = function (uid) {
    var st = G.player.state;
    var idx = -1;
    for (var i = 0; i < st.bag.length; i++) {
      if (st.bag[i].uid === uid) { idx = i; break; }
    }
    if (idx < 0) return false;
    var item = st.bag[idx];
    if (item.kind !== 'gear') return false;

    var slot = item.slot;
    var old = st.equip[slot];

    st.bag.splice(idx, 1);
    st.equip[slot] = item;

    if (old) st.bag.push(old);

    G.player.recalcStats();
    G.bus.emit('ui:dirty');
    G.bus.emit('sfx', 'equip');
    return true;
  };

  I.unequip = function (slot) {
    var st = G.player.state;
    var item = st.equip[slot];
    if (!item) return false;
    if (st.bag.length >= 40) { G.ui.toast('背包满了'); return false; }
    st.equip[slot] = null;
    st.bag.push(item);
    G.player.recalcStats();
    G.bus.emit('ui:dirty');
    return true;
  };

  I.useConsumable = function (uid) {
    var st = G.player.state;
    for (var i = 0; i < st.bag.length; i++) {
      if (st.bag[i].uid === uid) {
        var item = st.bag[i];
        if (item.kind !== 'consumable') return false;
        if (item.heal) {
          st.hp = Math.min(st.maxHp, st.hp + item.heal);
          G.fx.pickupBurst(st.x, st.z, '#7FB069');
          G.ui.toast('使用了 ' + item.name, 1200);
        }
        I.remove(uid, 1);
        G.bus.emit('ui:dirty');
        G.bus.emit('sfx', 'heal');
        return true;
      }
    }
    return false;
  };

  // =====================================================================
  // 重铸（赌博式）
  // =====================================================================
  I.reforgeCost = function (item) {
    if (!item || item.kind !== 'gear') return 0;
    return G.DATA.REFORGE_COST[item.quality - 1];
  };

  I.reforge = function (uid) {
    var st = G.player.state;
    var item = null, fromBag = false, bagIdx = -1;
    for (var s in st.equip) {
      if (st.equip[s] && st.equip[s].uid === uid) { item = st.equip[s]; fromBag = false; break; }
    }
    if (!item) {
      for (var i = 0; i < st.bag.length; i++) {
        if (st.bag[i].uid === uid) { item = st.bag[i]; fromBag = true; bagIdx = i; break; }
      }
    }
    if (!item || item.kind !== 'gear') return { ok: false, msg: '这不是装备' };

    var cost = I.reforgeCost(item);
    if (st.gold < cost) return { ok: false, msg: '金币不足（需要 ' + cost + '）' };

    st.gold -= cost;
    // 重掷全部词条
    var q = item.quality;
    var count = G.DATA.QUALITY_AFFIXES[q - 1];
    var affixes = [];
    var used = {};
    for (var k = 0; k < count; k++) {
      var pool = G.DATA.AFFIXES.filter(function (a) { return a.qualityMin <= q && !used[a.stat]; });
      if (!pool.length) break;
      var p = G.weighted(pool.map(function (a) { return { weight: a.weight, a: a }; }));
      if (!p) break;
      var af = p.a;
      used[af.stat] = true;
      var v = M.lerp(af.min, af.max, Math.pow(Math.random(), 0.7)) * (1 + (q - 1) * 0.12);
      v = (af.stat === 'crit' || af.stat === 'speed' || af.stat === 'lifesteal')
        ? Math.round(v * 1000) / 1000 : Math.round(v);
      affixes.push({ id: af.id, stat: af.stat, name: af.name, value: v, fmt: af.fmt });
    }
    item.affixes = affixes;
    G.player.recalcStats();
    G.bus.emit('ui:dirty');
    G.bus.emit('sfx', 'reforge');
    return { ok: true, item: item, cost: cost };
  };

  // =====================================================================
  // 掉落
  // =====================================================================
  var L = G.loot = { drops: [] };

  L.spawnFromTable = function (tableId, x, z, monsterDef) {
    var table = G.DATA.LOOT[tableId];
    if (!table) return;

    // 金币
    if (monsterDef) {
      var gold = Math.floor(M.lerp(monsterDef.goldMin, monsterDef.goldMax, Math.random()));
      if (gold > 0) L.spawnDrop('gold', x + (Math.random() - 0.5) * 1.2, z + (Math.random() - 0.5) * 1.2, { amount: gold });
    }

    // 保底
    if (table.guaranteed) {
      for (var g = 0; g < table.guaranteed.length; g++) {
        var it = I.instantiate(table.guaranteed[g]);
        if (it) L.spawnDrop('item', x + (Math.random() - 0.5) * 1.4, z + (Math.random() - 0.5) * 1.4, { item: it });
      }
    }

    // 条目
    var entries = table.entries || [];
    var pick = G.weighted(entries.map(function (en) {
      return { weight: en.weight, en: en };
    }));
    if (!pick) return;
    var ent = pick.en;
    var qty = 1;
    if (ent.qty) qty = ent.qty[0] + Math.floor(Math.random() * (ent.qty[1] - ent.qty[0] + 1));
    var item = I.instantiate(ent.itemId, { qualityFloor: ent.qualityFloor });
    if (!item) return;
    L.spawnDrop('item', x + (Math.random() - 0.5) * 1.4, z + (Math.random() - 0.5) * 1.4, { item: item, qty: qty });
  };

  L.spawnDrop = function (kind, x, z, data) {
    var group = new THREE.Group();
    var color = '#E8C25A';

    if (kind === 'gold') {
      var coinMat = G.celMaterial('#E8C25A', { steps: 2, darkness: 0.6, emissive: '#E8C25A', emissiveIntensity: 0.4 });
      for (var i = 0; i < 3; i++) {
        var coin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 8), coinMat);
        coin.rotation.x = Math.PI / 2;
        coin.position.set((Math.random() - 0.5) * 0.3, 0.12 + i * 0.06, (Math.random() - 0.5) * 0.3);
        group.add(coin);
      }
    } else {
      var q = data.item.quality || 2;
      color = G.DATA.QUALITY_COLORS[q - 1];
      var gemMat = G.celMaterial(color, { steps: 2, darkness: 0.5, emissive: color, emissiveIntensity: 0.55 });
      var gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), gemMat);
      gem.position.y = 0.3;
      group.add(gem);
      var glow = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.3, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.04;
      group.add(glow);
    }

    group.position.set(x, 0, z);
    G.world.scene.add(group);

    var drop = {
      kind: kind, x: x, z: z, group: group,
      data: data, life: 90,           // 90 秒后消失
      phase: Math.random() * 6.28,
      picked: false
    };
    L.drops.push(drop);
  };

  L.update = function (dt, st) {
    for (var i = L.drops.length - 1; i >= 0; i--) {
      var d = L.drops[i];
      d.life -= dt;
      // 浮动
      d.group.position.y = Math.sin(performance.now() * 0.002 + d.phase) * 0.06;
      // 靠近自动拾取
      var dist = M.dist(d.x, d.z, st.x, st.z);
      if (dist < 1.5 && !st.dead) {
        L.pickup(d, i);
        continue;
      }
      if (d.life <= 0) {
        if (d.group.parent) d.group.parent.remove(d.group);
        L.drops.splice(i, 1);
      }
    }
  };

  L.pickup = function (d, idx) {
    var st = G.player.state;
    if (d.kind === 'gold') {
      st.gold += d.data.amount;
      G.ui.toast('+' + d.data.amount + ' 文', 900);
      G.fx.pickupBurst(d.x, d.z, '#E8C25A');
    } else {
      var item = d.data.item;
      var qty = d.data.qty || 1;
      var ok = I.add(item, qty);
      if (ok) {
        var qn = G.DATA.QUALITY_NAMES[item.quality - 1] || '';
        var label = item.kind === 'gear' ? ('[' + qn + '] ' + item.name) : (item.name + (qty > 1 ? ' ×' + qty : ''));
        G.ui.toast('获得 ' + label, 1600);
        G.fx.pickupBurst(d.x, d.z, G.DATA.QUALITY_COLORS[(item.quality || 2) - 1]);
        G.bus.emit('sfx', item.kind === 'gear' && item.quality >= 4 ? 'pickup_rare' : 'pickup');
      }
    }
    if (d.group.parent) d.group.parent.remove(d.group);
    L.drops.splice(idx, 1);
    G.bus.emit('ui:dirty');
  };

  /** 玩家死亡：地上未拾取的掉落消失 */
  L.dropAll = function () {
    for (var i = 0; i < L.drops.length; i++) {
      var d = L.drops[i];
      if (d.group.parent) d.group.parent.remove(d.group);
    }
    if (L.drops.length > 0) {
      G.ui.toast('地上未拾取的物品散失了…', 2400);
    }
    L.drops.length = 0;
  };

  L.clear = function () {
    for (var i = 0; i < L.drops.length; i++) {
      if (L.drops[i].group.parent) L.drops[i].group.parent.remove(L.drops[i].group);
    }
    L.drops.length = 0;
  };

})(window.G = window.G || {});
