/* data/skills.js — 技能表 */
(function (G) {
  'use strict';
  G.DATA = G.DATA || {};

  G.DATA.SKILLS = {
    1: {
      id: 1, name: '抜刀・月影', romaji: 'battou getsuei',
      desc: '瞬身前斩。对前方扇形范围内的敌人造成 220% 攻击伤害。',
      type: 'dash_slash',
      cooldown: 4.0, damageMult: 2.2, radius: 3.4, arc: Math.PI * 0.6,
      dashDist: 4.2, hitstopMs: 90, shake: 0.42,
      sfx: 'skill1', vfx: 'moon_slash',
      unlock: { type: 'initial' }
    },
    2: {
      id: 2, name: '斬鉄・輪', romaji: 'zantetsu rin',
      desc: '原地旋转一周的环斩，对周围所有敌人造成 160% 攻击伤害并击退。',
      type: 'aoe_ring',
      cooldown: 6.0, damageMult: 1.6, radius: 3.0,
      hitstopMs: 70, shake: 0.36, knockback: 4.5,
      sfx: 'skill2', vfx: 'ring_slash',
      unlock: { type: 'initial' }
    },
    3: {
      id: 3, name: '飛刃・風切り', romaji: 'hibane kazakiri',
      desc: '投出穿透性的气刃，沿直线造成 130% 伤害，最多穿过 3 个敌人。',
      type: 'projectile',
      cooldown: 3.2, damageMult: 1.3, speed: 22, range: 13, pierce: 3,
      hitstopMs: 45, shake: 0.18,
      sfx: 'skill3', vfx: 'air_blade',
      unlock: { type: 'quest', value: 'town_03' }
    },
    4: {
      id: 4, name: '受け流し', romaji: 'ukenagashi',
      desc: '架刀格挡 1.2 秒；在此期间受到攻击则立即反击，造成 300% 伤害并击退。',
      type: 'parry',
      cooldown: 9.0, damageMult: 3.0, duration: 1.2, radius: 3.2,
      hitstopMs: 120, shake: 0.5, knockback: 7,
      sfx: 'skill4', vfx: 'parry_flash',
      unlock: { type: 'quest', value: 'town_05' }
    }
  };

  // 技能升级（预留）
  G.DATA.SKILL_ORDER = [1, 2, 3, 4];

})(window.G = window.G || {});
