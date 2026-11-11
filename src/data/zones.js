/* data/zones.js — 地图数据（纯字面量，改这里就能改世界）
 *
 * 一张箱庭 = 結ノ町（南，安全区）+ 霞ヶ原（北，野外）+ 忘れ緒の社（最北，副本入口）
 * 坐标：x 向右，z 向前（远离相机）
 */
(function (G) {
  'use strict';

  G.DATA = G.DATA || {};

  // 世界范围
  G.DATA.WORLD = {
    minX: -34, maxX: 34, minZ: -16, maxZ: 66,
    spawn: { x: 0, z: 6 }          // 出生点（城镇中央）
  };

  // 城镇范围（安全区，不刷怪）
  G.DATA.TOWN = { minX: -18, maxX: 18, minZ: -12, maxZ: 12, name: '結ノ町' };

  // ---------- 静态场景物件 ----------
  // type: torii|lantern|sakura|house|bamboo|stairs|rock|bush|fence|water|stele|knot|chest|pot|node|shrine|gate
  G.DATA.PROPS = [
    // ===== 城镇入口：鸟居 =====
    { type: 'torii', x: 0, z: 13, w: 7.5, h: 7.2, rotY: 0 },
    { type: 'torii', x: -11, z: 12.5, w: 4.2, h: 5.0, rotY: 0.1 },

    // ===== 城镇：主街灯笼 =====
    { type: 'lantern', x: -3.2, z: 9, poleH: 2.8 },
    { type: 'lantern', x: 3.2, z: 9, poleH: 2.8 },
    { type: 'lantern', x: -3.2, z: 4, poleH: 2.8 },
    { type: 'lantern', x: 3.2, z: 4, poleH: 2.8 },
    { type: 'lantern', x: -3.2, z: -1, poleH: 2.8 },
    { type: 'lantern', x: 3.2, z: -1, poleH: 2.8 },
    { type: 'lantern', x: -10, z: 6, poleH: 2.6 },
    { type: 'lantern', x: 10, z: 6, poleH: 2.6 },

    // ===== 城镇：房屋 =====
    { type: 'house', x: -12, z: 2, w: 6.5, d: 5.5, h: 2.6, rotY: 0.12, noren: '#D9483B' },
    { type: 'house', x: 12.5, z: 3, w: 6, d: 5.2, h: 2.5, rotY: -0.1, noren: '#7FB8D8' },
    { type: 'house', x: -13.5, z: -4, w: 5.6, d: 5, h: 2.4, rotY: 0.2, noren: '#9CB87A' },
    { type: 'house', x: 13, z: -5, w: 6.2, d: 5, h: 2.6, rotY: -0.16, noren: '#E8C25A' },
    { type: 'house', x: 0, z: -9.5, w: 7.5, d: 5.4, h: 3.0, rotY: 0, noren: '#7FB069' },

    // ===== 城镇：神社（存档/传送点） =====
    { type: 'shrine', x: 0, z: 8.5, rotY: 0 },

    // ===== 城镇：篱笆 =====
    { type: 'fence', x: -17, z: 8, len: 8, rotY: Math.PI / 2 },
    { type: 'fence', x: 17, z: 8, len: 8, rotY: Math.PI / 2 },
    { type: 'fence', x: -8, z: 11.5, len: 6, rotY: 0 },
    { type: 'fence', x: 8, z: 11.5, len: 6, rotY: 0 },

    // ===== 城镇：樱花 =====
    { type: 'sakura', x: -7, z: -7, scale: 1.15, seed: 11 },
    { type: 'sakura', x: 7.5, z: -6.5, scale: 1.05, seed: 22 },
    { type: 'sakura', x: -15, z: 9.5, scale: 0.95, seed: 33 },
    { type: 'sakura', x: 15.5, z: 10, scale: 1.0, seed: 44 },
    { type: 'sakura', x: -6.5, z: 12.5, scale: 0.85, seed: 55 },
    { type: 'sakura', x: 6.8, z: 12.8, scale: 0.9, seed: 66 },

    // ===== 城镇：罐子（可破坏） =====
    { type: 'pot', x: -9.5, z: 8.5, uid: 'pot_t1' },
    { type: 'pot', x: 9.8, z: 8.2, uid: 'pot_t2' },
    { type: 'pot', x: -12.5, z: -1.5, uid: 'pot_t3' },
    { type: 'pot', x: 12.8, z: -2, uid: 'pot_t4' },

    // ===== 城镇：碑文 =====
    { type: 'stele', x: -4.5, z: 10.5, uid: 'stele_town_1' },

    // ===== 野外：溪谷 =====
    { type: 'water', x: -22, z: 34, w: 7, d: 34, y: -0.14 },

    // ===== 野外：竹林 =====
    { type: 'bamboo', x: 16, z: 26, count: 9, spread: 3.2, seed: 101 },
    { type: 'bamboo', x: -10, z: 44, count: 8, spread: 2.8, seed: 102 },
    { type: 'bamboo', x: 24, z: 48, count: 10, spread: 3.5, seed: 103 },
    { type: 'bamboo', x: 8, z: 56, count: 7, spread: 2.4, seed: 104 },

    // ===== 野外：樱花 =====
    { type: 'sakura', x: -6, z: 22, scale: 1.2, seed: 201 },
    { type: 'sakura', x: 12, z: 34, scale: 1.35, seed: 202 },
    { type: 'sakura', x: -14, z: 52, scale: 1.1, seed: 203 },
    { type: 'sakura', x: 20, z: 20, scale: 1.0, seed: 204 },
    { type: 'sakura', x: -18, z: 28, scale: 1.25, seed: 205 },
    { type: 'sakura', x: 4, z: 48, scale: 1.15, seed: 206 },

    // ===== 野外：岩石 =====
    { type: 'rock', x: -25, z: 22, size: 1.2, seed: 301 },
    { type: 'rock', x: 26, z: 30, size: 1.5, seed: 302 },
    { type: 'rock', x: -19, z: 40, size: 1.0, seed: 303 },
    { type: 'rock', x: 18, z: 42, size: 1.3, seed: 304 },
    { type: 'rock', x: -13, z: 58, size: 1.6, seed: 305 },
    { type: 'rock', x: 14, z: 58, size: 1.4, seed: 306 },
    { type: 'rock', x: 28, z: 54, size: 1.1, seed: 307 },
    { type: 'rock', x: -28, z: 50, size: 1.3, seed: 308 },

    // ===== 野外：灌木 =====
    { type: 'bush', x: -4, z: 18, seed: 401 },
    { type: 'bush', x: 6, z: 20, seed: 402 },
    { type: 'bush', x: -9, z: 30, seed: 403 },
    { type: 'bush', x: 14, z: 28, seed: 404 },
    { type: 'bush', x: -16, z: 36, seed: 405 },
    { type: 'bush', x: 2, z: 40, seed: 406 },
    { type: 'bush', x: -6, z: 52, seed: 407 },
    { type: 'bush', x: 11, z: 50, seed: 408 },

    // ===== 野外：石阶（通往副本） =====
    { type: 'stairs', x: 0, z: 60, steps: 6, w: 4.5, rise: 0.2, run: 0.5 },

    // ===== 野外：碑文（世界观碎片） =====
    { type: 'stele', x: 3.5, z: 17.5, uid: 'stele_field_1' },
    { type: 'stele', x: -20, z: 33, uid: 'stele_field_2' },
    { type: 'stele', x: 22, z: 45, uid: 'stele_field_3' },
    { type: 'stele', x: -8, z: 55, uid: 'stele_field_4' },

    // ===== 野外：结（3 处主线探索点） =====
    { type: 'knot', x: -20, z: 24, uid: 'knot_1', color: '#F7C8D8' },
    { type: 'knot', x: 21, z: 36, uid: 'knot_2', color: '#B8DCE8' },
    { type: 'knot', x: -3, z: 56, uid: 'knot_3', color: '#D9A0E8' },

    // ===== 野外：宝箱 =====
    { type: 'chest', x: -24, z: 28, uid: 'chest_f1', loot: 'common' },
    { type: 'chest', x: 25, z: 40, uid: 'chest_f2', loot: 'common' },
    { type: 'chest', x: -12, z: 47, uid: 'chest_f3', loot: 'rare' },
    { type: 'chest', x: 9, z: 59, uid: 'chest_f4', loot: 'rare' },
    { type: 'chest', x: 0, z: 44, uid: 'chest_f5', loot: 'common' },

    // ===== 野外：可破坏罐子 =====
    { type: 'pot', x: -7, z: 26, uid: 'pot_f1' },
    { type: 'pot', x: 8, z: 27, uid: 'pot_f2' },
    { type: 'pot', x: -15, z: 45, uid: 'pot_f3' },
    { type: 'pot', x: 16, z: 52, uid: 'pot_f4' },

    // ===== 野外：采集节点 =====
    { type: 'node', x: -11, z: 20, uid: 'node_herb_1', nodeType: 'herb' },
    { type: 'node', x: 13, z: 23, uid: 'node_herb_2', nodeType: 'herb' },
    { type: 'node', x: -17, z: 38, uid: 'node_herb_3', nodeType: 'herb' },
    { type: 'node', x: 2, z: 31, uid: 'node_ore_1', nodeType: 'ore' },
    { type: 'node', x: -22, z: 46, uid: 'node_ore_2', nodeType: 'ore' },
    { type: 'node', x: 19, z: 55, uid: 'node_ore_3', nodeType: 'ore' },

    // ===== 副本入口（石门） =====
    { type: 'gate', x: 0, z: 63, uid: 'gate_dungeon' }
  ];

  // ---------- NPC ----------
  G.DATA.NPCS = [
    {
      id: 'npc_chie', name: '千絵', title: '結び手の先達',
      look: { kimono: '#F7C8D8', kimonoSh: '#D9A0B8', hair: '#6B4A3A', hairSh: '#4A3025',
              obi: '#7FB069', obiSh: '#5C8A4A' },
      day: { x: 2.5, z: 10.5 }, night: { x: -12, z: -1.5 },
      dialogue: 'd_chie_intro'
    },
    {
      id: 'npc_tetsu', name: '鉄次', title: '鍛冶',
      look: { kimono: '#B08060', kimonoSh: '#7A5540', hair: '#3B2E36', hairSh: '#2A1F26',
              obi: '#5B4A44', obiSh: '#3A2E2A' },
      day: { x: -12.5, z: 3.5 }, night: { x: 12.5, z: 3.5 },
      dialogue: 'd_tetsu_shop', shop: 'shop_tetsu'
    },
    {
      id: 'npc_anzu', name: '杏', title: '旅の商人',
      look: { kimono: '#E8C25A', kimonoSh: '#B89840', hair: '#8B5A3C', hairSh: '#6B3F28',
              obi: '#D9483B', obiSh: '#A8302A' },
      day: { x: 12.5, z: 9 }, night: { x: 4, z: 4 },
      dialogue: 'd_anzu_chat', shop: 'shop_anzu'
    },
    {
      id: 'npc_roji', name: 'ろじ', title: '灯守',
      look: { kimono: '#C8C3B8', kimonoSh: '#9A968C', hair: '#D8D2C4', hairSh: '#B8B2A4',
              obi: '#9A968C', obiSh: '#7A766C' },
      day: { x: -2, z: 8 }, night: { x: 0, z: 8.5 },
      dialogue: 'd_roji_lore'
    }
  ];

  // ---------- 刷怪表（按区域） ----------
  G.DATA.SPAWN_ZONES = [
    {
      id: 'field_near', name: '霞ヶ原・入口',
      minX: -16, maxX: 16, minZ: 16, maxZ: 30,
      day: [{ id: 'onibi', count: 3 }, { id: 'kappa', count: 2 }],
      night: [{ id: 'yurei', count: 4 }, { id: 'onibi', count: 2 }],
      respawnSec: 22
    },
    {
      id: 'field_mid', name: '霞ヶ原・竹林',
      minX: -28, maxX: 28, minZ: 30, maxZ: 46,
      day: [{ id: 'kappa', count: 3 }, { id: 'oni_small', count: 2 }],
      night: [{ id: 'yurei', count: 3 }, { id: 'oni_small', count: 3 }],
      respawnSec: 26
    },
    {
      id: 'field_far', name: '霞ヶ原・社前',
      minX: -14, maxX: 14, minZ: 46, maxZ: 60,
      day: [{ id: 'oni_small', count: 3 }, { id: 'tengu', count: 2 }],
      night: [{ id: 'tengu', count: 3 }, { id: 'yurei', count: 2 }],
      respawnSec: 30
    }
  ];

  // ---------- 副本 ----------
  G.DATA.DUNGEON = {
    id: 'wasureo',
    name: '忘れ緒の社',
    entry: { x: 0, z: 63 },
    // 3 房间 + Boss 房，一条直线推进，每间有障碍与怪
    rooms: [
      { id: 'r1', name: '拝殿',   x: 0,  z: 0,  w: 14, d: 14, enemies: [{ id: 'onibi', count: 3 }] },
      { id: 'r2', name: '回廊',   x: 0,  z: -18, w: 12, d: 14, enemies: [{ id: 'yurei', count: 3 }, { id: 'kappa', count: 1 }] },
      { id: 'r3', name: '本殿前', x: 0,  z: -36, w: 16, d: 14, enemies: [{ id: 'oni_small', count: 2 }, { id: 'tengu', count: 2 }] },
      { id: 'boss', name: '結び目の間', x: 0, z: -56, w: 20, d: 18, boss: 'musubi_no_kami' }
    ]
  };

})(window.G = window.G || {});
