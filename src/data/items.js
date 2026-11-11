/* data/items.js — 物品、词缀、商店 */
(function (G) {
  'use strict';
  G.DATA = G.DATA || {};

  // ---------- 固定物品 ----------
  G.DATA.ITEMS = {
    // 消耗品
    potion_small: { id: 'potion_small', name: '小伤药', kind: 'consumable',
      desc: '恢复 40 点生命。', value: 12, stack: 9, heal: 40,
      icon: { shape: 'bottle', color: '#E05A4F' } },
    potion_mid: { id: 'potion_mid', name: '中伤药', kind: 'consumable',
      desc: '恢复 110 点生命。', value: 34, stack: 9, heal: 110,
      icon: { shape: 'bottle', color: '#C8382E' } },

    // 素材
    mat_ember: { id: 'mat_ember', name: '鬼火之灰', kind: 'material', value: 4, stack: 99,
      desc: '鬼火燃尽后留下的灰，还带着余温。', icon: { shape: 'shard', color: '#B8DCE8' } },
    mat_shell: { id: 'mat_shell', name: '河童甲壳', kind: 'material', value: 6, stack: 99,
      desc: '坚硬的甲片，据说能防水。', icon: { shape: 'shard', color: '#7FB069' } },
    mat_veil: { id: 'mat_veil', name: '幽霊薄纱', kind: 'material', value: 8, stack: 99,
      desc: '触手冰凉，放久了会变淡。', icon: { shape: 'shard', color: '#D8D2C4' } },
    mat_horn: { id: 'mat_horn', name: '鬼角', kind: 'material', value: 14, stack: 99,
      desc: '从小鬼头上折下的角，硬得能敲钉子。', icon: { shape: 'shard', color: '#D9483B' } },
    mat_feather: { id: 'mat_feather', name: '天狗羽', kind: 'material', value: 22, stack: 99,
      desc: '一片就比手掌还长，风穿过时会响。', icon: { shape: 'shard', color: '#3A2E2A' } },

    // 保底装备（商店卖）
    gear_shop_blade: { id: 'gear_shop_blade', name: '打刀・素', kind: 'gear',
      slot: 'weapon', quality: 2, baseAtk: 8, baseDef: 0, affixSlots: 1,
      value: 120, desc: '铁次打的量产刀。没有任何花巧，但不会背叛你。' },
    gear_shop_charm: { id: 'gear_shop_charm', name: '护符・素', kind: 'gear',
      slot: 'charm', quality: 2, baseAtk: 2, baseDef: 2, affixSlots: 1,
      value: 90, desc: '朴素的木符，据说能挡一次灾。' },
    gear_shop_robe: { id: 'gear_shop_robe', name: '衣装・素', kind: 'gear',
      slot: 'robe', quality: 2, baseAtk: 0, baseDef: 5, affixSlots: 1,
      value: 100, desc: '结ノ町裁缝做的旅行衣，耐磨。' },

    // Boss 掉落（保底）
    gear_boss_weapon: { id: 'gear_boss_weapon', name: '結刀・むすび', kind: 'gear',
      slot: 'weapon', quality: 5, baseAtk: 26, baseDef: 2, affixSlots: 3,
      value: 900, desc: '刀身上有一道会自己移动的纹路，像一条没打完的结。' }
  };

  // ---------- 词缀池 ----------
  G.DATA.AFFIXES = [
    { id: 'atk1', stat: 'atk', name: '锋利', min: 2, max: 6, weight: 30, qualityMin: 1, fmt: '+{v} 攻击' },
    { id: 'atk2', stat: 'atk', name: '锐利', min: 5, max: 12, weight: 18, qualityMin: 2, fmt: '+{v} 攻击' },
    { id: 'def1', stat: 'def', name: '坚固', min: 1, max: 4, weight: 26, qualityMin: 1, fmt: '+{v} 防御' },
    { id: 'def2', stat: 'def', name: '磐石', min: 3, max: 8, weight: 14, qualityMin: 3, fmt: '+{v} 防御' },
    { id: 'hp1', stat: 'hp', name: '生气', min: 8, max: 22, weight: 24, qualityMin: 1, fmt: '+{v} 生命' },
    { id: 'hp2', stat: 'hp', name: '生命力', min: 20, max: 50, weight: 12, qualityMin: 3, fmt: '+{v} 生命' },
    { id: 'crit1', stat: 'crit', name: '会心', min: 0.03, max: 0.08, weight: 16, qualityMin: 2, fmt: '+{p}% 暴击' },
    { id: 'spd1', stat: 'speed', name: '轻身', min: 0.02, max: 0.06, weight: 15, qualityMin: 2, fmt: '+{p}% 移速' },
    { id: 'ls1', stat: 'lifesteal', name: '吸魂', min: 0.02, max: 0.05, weight: 8, qualityMin: 4, fmt: '+{p}% 吸血' }
  ];

  // ---------- 品质 ----------
  G.DATA.QUALITY_NAMES = ['粗物', '常品', '良品', '名品', '灵宝'];
  G.DATA.QUALITY_COLORS = ['#9A968C', '#D8D2C4', '#7FB069', '#7FB8D8', '#D9A0E8'];
  // 品质 -> 词缀数量
  G.DATA.QUALITY_AFFIXES = [1, 1, 2, 2, 3];
  // 品质 -> 基础属性倍率
  G.DATA.QUALITY_MULT = [0.75, 1.0, 1.25, 1.6, 2.1];
  // 词条重铸价格
  G.DATA.REFORGE_COST = [12, 28, 70, 160, 380];

  // ---------- 装备生成模板 ----------
  G.DATA.GEAR_TEMPLATES = {
    weapon: { names: ['打刀', '太刀', '脇差', '薙刀'], baseAtk: [6, 9], baseDef: [0, 1] },
    charm:  { names: ['护符', '御守', '勾玉'], baseAtk: [1, 3], baseDef: [1, 3] },
    robe:   { names: ['衣装', '羽织', '装束'], baseAtk: [0, 1], baseDef: [3, 6] }
  };
  G.DATA.GEAR_SUFFIX = ['・素', '・霞', '・月', '・影', '・結', '・灯', '・風', '・雪'];

  // ---------- 商店 ----------
  G.DATA.SHOPS = {
    shop_tetsu: {
      id: 'shop_tetsu', name: '鉄次の鍛冶屋',
      greeting: '刀要看的是刃，不是柄。你要哪样？',
      stock: ['gear_shop_blade', 'gear_shop_robe', 'gear_shop_charm'],
      reforge: true
    },
    shop_anzu: {
      id: 'shop_anzu', name: '杏の行商',
      greeting: '从远处来的货，路上还遇到点事。随便看看？',
      stock: ['potion_small', 'potion_mid'],
      reforge: false
    }
  };

  // ---------- 宝箱内容 ----------
  G.DATA.CHESTS = {
    common: { gold: [8, 24], items: [{ id: 'potion_small', min: 1, max: 2 }, { id: 'gear_roll', min: 1, max: 1, qualityFloor: 1 }] },
    rare:   { gold: [30, 70], items: [{ id: 'potion_mid', min: 1, max: 2 }, { id: 'gear_roll', min: 1, max: 1, qualityFloor: 3 }] }
  };

})(window.G = window.G || {});
