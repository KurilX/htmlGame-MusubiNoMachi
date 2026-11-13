/* data/quests.js — 任务数据（多地区主线 + 支线）
 *
 * 【设计目标】
 *  1) **每个地区一条独立主线**，结构统一，加新城镇只需往 QUESTS 里加数据
 *  2) 主线必须包含「打怪」和「Boss」环节（用户明确要求）
 *  3) 新手引导：开局有明确指引，不需要猜
 *
 * 【主线编号约定】
 *   region_章节_序号，例如 town_01 / town_02 ...
 *   这样从 id 就能看出属于哪个地区、第几章。
 *   每个主线任务的 def.region 字段标明所属地区，
 *   def.chapter 标明章节序号，供 UI 分组与进度显示。
 *
 * 【步骤类型】（由 61-quest.js 的钩子消费）
 *   talk    : 与 NPC 对话           target = npcId
 *   kill    : 击杀 N 只某怪         target = monsterId, count = N
 *   boss    : 击杀 Boss（单只）      target = monsterId
 *   knot    : 系结（交互物）         target = uid
 *   collect : 收集 N 个某物品        target = itemId, count = N
 *   reach   : 到达某地点             target = uid
 *   interact: 与任意可交互物互动      target = uid
 */
(function (G) {
  'use strict';
  G.DATA = G.DATA || {};

  // =====================================================================
  // 任务定义
  // =====================================================================
  G.DATA.QUESTS = {

    // -----------------------------------------------------------------
    // 結ノ町 主线（初始地）—— 5 章，含打怪与 Boss
    // -----------------------------------------------------------------
    town_01: {
      id: 'town_01',
      region: 'town', chapter: 1,
      title: '初次的委托',
      giver: 'npc_chie',
      brief: '千絵让你去霞ヶ原清理几只游荡的妖物，好让镇上的孩子敢出门。',
      hint: '按 I 打开背包看看装备，然后从鸟居出镇往北走。',
      steps: [
        { type: 'kill', target: 'onibi', count: 3, text: '击退鬼火' }
      ],
      rewards: { exp: 90, gold: 60 },
      nextId: 'town_02'
    },

    town_02: {
      id: 'town_02',
      region: 'town', chapter: 2,
      title: '断了的路',
      giver: 'npc_chie',
      brief: '去霞ヶ原找三处断掉的结，把它们系回去。',
      hint: '结会发出微光。沿着土路往北，注意路边的石台。',
      steps: [
        { type: 'knot', target: 'knot_1', text: '系上溪边的结' },
        { type: 'knot', target: 'knot_2', text: '系上竹林尽头的结' },
        { type: 'knot', target: 'knot_3', text: '系上社前的结' }
      ],
      rewards: { exp: 140, gold: 90 },
      nextId: 'town_03'
    },

    town_03: {
      id: 'town_03',
      region: 'town', chapter: 3,
      title: '竹林深处',
      giver: 'npc_chie',
      brief: '竹林的妖物被结的震动惊动了。清掉它们，再回来复命。',
      hint: '竹林在霞ヶ原中段，那里怪最密。',
      steps: [
        { type: 'kill', target: 'kappa', count: 4, text: '击退河童' },
        { type: 'kill', target: 'tengu', count: 2, text: '击退天狗' }
      ],
      rewards: { exp: 200, gold: 120, unlockSkill: 3 },
      nextId: 'town_04'
    },

    town_04: {
      id: 'town_04',
      region: 'town', chapter: 4,
      title: '门后的东西',
      giver: 'npc_chie',
      brief: '社前的门开了。里面有个不该醒的东西。',
      hint: '门在最北端。进去之前先补满血、吃个药。',
      steps: [
        { type: 'reach', target: 'gate_dungeon', text: '走到忘れ緒の社前' }
      ],
      rewards: { exp: 180, gold: 110 },
      nextId: 'town_05'
    },

    town_05: {
      id: 'town_05',
      region: 'town', chapter: 5,
      title: '結びの神',
      giver: 'npc_chie',
      brief: '那东西自称「結びの神」。把它按回去。',
      hint: 'Boss 的血条是紫色的。它抬手时会亮，那就是要出手了。',
      steps: [
        { type: 'boss', target: 'musubi_no_kami', text: '击败結びの神' }
      ],
      rewards: { exp: 600, gold: 400, unlockSkill: 4 },
      nextId: 'town_06'
    },

    town_06: {
      id: 'town_06',
      region: 'town', chapter: 6,
      title: '回來的人',
      giver: 'npc_chie',
      brief: '你回来了。千絵在等你。',
      hint: '回镇上找千絵。',
      steps: [
        { type: 'talk', target: 'npc_chie', text: '向千絵复命' }
      ],
      rewards: { exp: 300, gold: 200 },
      nextId: null
    },

    // -----------------------------------------------------------------
    // 支线（初始地）
    // -----------------------------------------------------------------
    side_roji_01: {
      id: 'side_roji_01',
      region: 'town', chapter: 0,
      title: '灯守的请求',
      giver: 'npc_roji',
      brief: '替ろじ带 3 份鬼火之灰回来。',
      hint: '鬼火夜里更多。',
      steps: [
        { type: 'collect', target: 'mat_ember', count: 3, text: '收集鬼火之灰' }
      ],
      rewards: { exp: 70, gold: 60 },
      nextId: null
    },

    side_tetsu_01: {
      id: 'side_tetsu_01',
      region: 'town', chapter: 0,
      title: '铁次的赌注',
      giver: 'npc_tetsu',
      brief: '铁次说，能带回 2 份精铁，就免费帮你打一件东西。',
      hint: '精铁在竹林里的矿点。',
      steps: [
        { type: 'collect', target: 'mat_iron', count: 2, text: '收集精铁' }
      ],
      rewards: { exp: 90, gold: 120 },
      nextId: null
    },

    side_anzu_01: {
      id: 'side_anzu_01',
      region: 'town', chapter: 0,
      title: '杏的行商路',
      giver: 'npc_anzu',
      brief: '杏想确认社前的路还通不通。',
      hint: '一直往北走到门前。',
      steps: [
        { type: 'reach', target: 'gate_dungeon', text: '确认社前的路' }
      ],
      rewards: { exp: 60, gold: 80 },
      nextId: null
    }
  };

  // =====================================================================
  // 地区主线索引
  //
  // 加新城镇时只需在 QUESTS 里加数据，并在这里注册一条链，
  // UI 与引导会据此自动工作。
  // =====================================================================
  G.DATA.QUEST_LINES = {
    town: {
      region: 'town',
      name: '結ノ町',
      startId: 'town_01',
      // 章节顺序（用于日志 UI 分组与"当前第几章"显示）
      order: ['town_01', 'town_02', 'town_03', 'town_04', 'town_05', 'town_06']
    }
    // 将来：
    // mountain: { region: 'mountain', name: '神山', startId: 'mtn_01', order: [...] },
    // harbor:   { region: 'harbor',   name: '湊町', startId: 'hbr_01', order: [...] },
    // beach:    { region: 'beach',    name: '渚',   startId: 'bch_01', order: [...] }
  };

  // npc -> 对话 id 的映射在 data/zones.js 的 NPCS 里
  G.DATA.DIALOGUE_BY_QUEST = {};

})(window.G = window.G || {});
