/* data/monsters.js — 怪物表 */
(function (G) {
  'use strict';
  G.DATA = G.DATA || {};

  // ai: chaser | ranged | pack | tank | boss
  G.DATA.MONSTERS = {
    onibi: {
      id: 'onibi', name: '鬼火', tier: 'normal',
      hp: 46, atk: 9, def: 1, speed: 2.4,
      radius: 0.42, height: 1.2,
      aggroRange: 9, attackRange: 1.5, attackCd: 1.6,
      telegraphSec: 0.55, windup: 0.28,
      ai: 'chaser',
      exp: 12, goldMin: 2, goldMax: 6,
      loot: 'loot_onibi',
      flags: { nocturnal: true, floating: true },
      look: { kimono: '#B8DCE8', kimonoSh: '#7A9CB0', hair: '#E8F4F8', hairSh: '#B8D0D8',
              obi: '#8FC4D8', obiSh: '#5F94A8', skin: '#DCE8EC', skinSh: '#B8C8CE' },
      // 飘浮：无腿，用光球表现，这里仍用 chibi 但压低
      floatOffset: 0.35
    },
    kappa: {
      id: 'kappa', name: '河童', tier: 'normal',
      hp: 78, atk: 12, def: 3, speed: 3.1,
      radius: 0.45, height: 1.6,
      aggroRange: 10, attackRange: 1.7, attackCd: 1.4,
      telegraphSec: 0.5, windup: 0.22,
      ai: 'chaser',
      exp: 18, goldMin: 3, goldMax: 9,
      loot: 'loot_kappa',
      look: { kimono: '#7FB069', kimonoSh: '#5C8A4A', hair: '#4A6B3A', hairSh: '#344E28',
              obi: '#C9A87C', obiSh: '#9C7C55', skin: '#A8C583', skinSh: '#7FA060' }
    },
    yurei: {
      id: 'yurei', name: '幽霊', tier: 'normal',
      hp: 62, atk: 14, def: 2, speed: 2.2,
      radius: 0.42, height: 1.7,
      aggroRange: 11, attackRange: 1.6, attackCd: 1.9,
      telegraphSec: 0.6, windup: 0.3,
      ai: 'ranged',
      projectileSpeed: 8.5,
      exp: 20, goldMin: 4, goldMax: 11,
      loot: 'loot_yurei',
      flags: { nocturnal: true, floating: true },
      look: { kimono: '#D8D2C4', kimonoSh: '#A8A296', hair: '#2A1F26', hairSh: '#1A1216',
              obi: '#9A968C', obiSh: '#7A766C', skin: '#F0EAE0', skinSh: '#C8C0B4' },
      floatOffset: 0.5
    },
    oni_small: {
      id: 'oni_small', name: '小鬼', tier: 'normal',
      hp: 118, atk: 17, def: 6, speed: 2.8,
      radius: 0.55, height: 1.9,
      aggroRange: 12, attackRange: 1.9, attackCd: 2.1,
      telegraphSec: 0.75, windup: 0.35,
      ai: 'tank',
      exp: 30, goldMin: 6, goldMax: 16,
      loot: 'loot_oni',
      look: { kimono: '#D9483B', kimonoSh: '#A8302A', hair: '#2A1F26', hairSh: '#1A1216',
              obi: '#3A2E2A', obiSh: '#241A18', skin: '#D9705E', skinSh: '#A8503E' }
    },
    tengu: {
      id: 'tengu', name: '天狗', tier: 'elite',
      hp: 210, atk: 24, def: 9, speed: 3.4,
      radius: 0.58, height: 2.0,
      aggroRange: 13, attackRange: 2.1, attackCd: 1.8,
      telegraphSec: 0.85, windup: 0.4,
      ai: 'chaser',
      exp: 55, goldMin: 12, goldMax: 30,
      loot: 'loot_tengu',
      // 精英：有护盾阶段
      shieldPhase: true,
      look: { kimono: '#3A2E2A', kimonoSh: '#241A18', hair: '#D8D2C4', hairSh: '#B8B2A4',
              obi: '#D9483B', obiSh: '#A8302A', skin: '#C8A898', skinSh: '#A08478' }
    },
    // ---------- 副本 Boss ----------
    musubi_no_kami: {
      id: 'musubi_no_kami', name: '結びの神', tier: 'boss',
      hp: 900, atk: 30, def: 12, speed: 2.2,
      radius: 1.1, height: 3.0,
      aggroRange: 20, attackRange: 3.2, attackCd: 2.6,
      telegraphSec: 1.0, windup: 0.5,
      ai: 'boss',
      exp: 260, goldMin: 60, goldMax: 120,
      loot: 'loot_boss',
      look: { kimono: '#D9A0E8', kimonoSh: '#A878B8', hair: '#F7C8D8', hairSh: '#D9A0B8',
              obi: '#E8C25A', obiSh: '#B89840', skin: '#FCE0CE', skinSh: '#E8BFA8' },
      phases: [
        { hpBelow: 1.0, move: 'melee_combo' },
        { hpBelow: 0.65, move: 'summon' },
        { hpBelow: 0.32, move: 'aoe_slam' }
      ]
    }
  };

  // ---------- 怪物掉落表 ----------
  G.DATA.LOOT = {
    loot_onibi: {
      goldWeight: 1,
      entries: [
        { itemId: 'mat_ember', weight: 40, qty: [1, 2] },
        { itemId: 'potion_small', weight: 22, qty: [1, 1] },
        { itemId: 'gear_roll', weight: 8, qualityFloor: 1 }
      ]
    },
    loot_kappa: {
      goldWeight: 1,
      entries: [
        { itemId: 'mat_shell', weight: 38, qty: [1, 2] },
        { itemId: 'potion_small', weight: 24, qty: [1, 1] },
        { itemId: 'gear_roll', weight: 10, qualityFloor: 1 }
      ]
    },
    loot_yurei: {
      goldWeight: 1,
      entries: [
        { itemId: 'mat_veil', weight: 36, qty: [1, 2] },
        { itemId: 'potion_small', weight: 20, qty: [1, 1] },
        { itemId: 'gear_roll', weight: 12, qualityFloor: 1 }
      ]
    },
    loot_oni: {
      goldWeight: 1,
      entries: [
        { itemId: 'mat_horn', weight: 34, qty: [1, 1] },
        { itemId: 'potion_mid', weight: 18, qty: [1, 1] },
        { itemId: 'gear_roll', weight: 16, qualityFloor: 2 }
      ]
    },
    loot_tengu: {
      goldWeight: 1,
      entries: [
        { itemId: 'mat_feather', weight: 30, qty: [1, 2] },
        { itemId: 'potion_mid', weight: 22, qty: [1, 1] },
        { itemId: 'gear_roll', weight: 24, qualityFloor: 2 }
      ]
    },
    loot_boss: {
      goldWeight: 1,
      guaranteed: ['gear_boss_weapon'],
      entries: [
        { itemId: 'potion_mid', weight: 30, qty: [2, 3] },
        { itemId: 'gear_roll', weight: 40, qualityFloor: 4 }
      ]
    }
  };

})(window.G = window.G || {});
