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
    },

    // =====================================================================
    // 神山主线：岩融の窟（4 章）
    //
    // 主题：「被封住的东西不该被叫醒」
    // 宮司守着山顶，发现石窟的封印在松；玩家的选择是重新封上而不是杀死它。
    // =====================================================================
    mtn_01: {
      id: 'mtn_01',
      region: 'mountain', chapter: 1,
      title: '登山的石阶',
      giver: 'npc_kannushi',
      brief: '宫司说，通往山顶的石阶上最近聚了不少妖物，上山的人回不来。',
      hint: '从北边的山门鸟居开始往上走，山道两侧会有天狗。',
      steps: [
        { type: 'kill', target: 'tengu', count: 3, text: '击退山道上的天狗' }
      ],
      rewards: { exp: 150, gold: 100 },
      nextId: 'mtn_02'
    },

    mtn_02: {
      id: 'mtn_02',
      region: 'mountain', chapter: 2,
      title: '松动的封印',
      giver: 'npc_kannushi',
      brief: '石窟的封印石裂了。去山腰看看，把散落的印记找回来。',
      hint: '山腰的碑文记着封印的来历。',
      steps: [
        { type: 'reach', target: 'gate_mountain', text: '走到岩融の窟前' }
      ],
      rewards: { exp: 180, gold: 120 },
      nextId: 'mtn_03'
    },

    mtn_03: {
      id: 'mtn_03',
      region: 'mountain', chapter: 3,
      title: '窟の中',
      giver: 'npc_kannushi',
      brief: '门后的东西已经开始动了。清掉窟里的小鬼，别让它们护着它。',
      hint: '窟里很暗，但每间房有灯。清光一间才开下一间。',
      steps: [
        { type: 'kill', target: 'oni_small', count: 4, text: '清掉窟里的小鬼' }
      ],
      rewards: { exp: 240, gold: 160, unlockSkill: 3 },
      nextId: 'mtn_04'
    },

    mtn_04: {
      id: 'mtn_04',
      region: 'mountain', chapter: 4,
      title: '岩融',
      giver: 'npc_kannushi',
      brief: '古岩之灵已经完全醒来。把它按回去——这次要压得比上次更紧。',
      hint: '岩融动作慢，但一击很重。它抬手时地面会亮，那是砸地的预兆。',
      steps: [
        { type: 'boss', target: 'iwakaguri', text: '击败岩融' }
      ],
      rewards: { exp: 700, gold: 450, unlockSkill: 4 },
      nextId: 'mtn_05'
    },

    mtn_05: {
      id: 'mtn_05',
      region: 'mountain', chapter: 5,
      title: '封上',
      giver: 'npc_kannushi',
      brief: '回去找宫司。他要把封印重新系上。',
      hint: '宫司在山顶神社前。',
      steps: [
        { type: 'talk', target: 'npc_kannushi', text: '向宫司复命' }
      ],
      rewards: { exp: 350, gold: 250 },
      nextId: null
    },

    // =====================================================================
    // 湊町主线：潮の淵（4 章）
    //
    // 主题：「网里捞上来的不该是人的东西」
    // 渔师头的网连着三天捞上同一块木牌，海上出现了不该有的声音。
    // =====================================================================
    hbr_01: {
      id: 'hbr_01',
      region: 'harbor', chapter: 1,
      title: '不祥的渔获',
      giver: 'npc_amimoto',
      brief: '与一的网连着三天捞上同一块木牌。他想知道海里到底有什么。',
      hint: '码头的仓库附近有不少河童在翻箱子。',
      steps: [
        { type: 'kill', target: 'kappa', count: 3, text: '赶走翻箱子的河童' }
      ],
      rewards: { exp: 140, gold: 110 },
      nextId: 'hbr_02'
    },

    hbr_02: {
      id: 'hbr_02',
      region: 'harbor', chapter: 2,
      title: '栈桥的尽头',
      giver: 'npc_amimoto',
      brief: '木牌上的字被海水泡烂了，只认得「潮の淵」三个字。去栈桥尽头看看。',
      hint: '栈桥一直伸到海里。走到最远端。',
      steps: [
        { type: 'reach', target: 'gate_beach', text: '走到沙滩南端的潮の淵入口' }
      ],
      rewards: { exp: 170, gold: 130 },
      nextId: 'hbr_03'
    },

    hbr_03: {
      id: 'hbr_03',
      region: 'harbor', chapter: 3,
      title: '退潮之后',
      giver: 'npc_amimoto',
      brief: '退潮了，渊露了出来。里面的幽霊都是被海留下的人。',
      hint: '渊里以幽霊为主，它们怕光——用技能打比硬拼省事。',
      steps: [
        { type: 'kill', target: 'yurei', count: 4, text: '让渊里的幽霊安息' }
      ],
      rewards: { exp: 260, gold: 180 },
      nextId: 'hbr_04'
    },

    hbr_04: {
      id: 'hbr_04',
      region: 'harbor', chapter: 4,
      title: '潮の女',
      giver: 'npc_amimoto',
      brief: '渊底有人在唱歌。那是被海吞掉的人的记忆聚成的形体。',
      hint: '潮の女移动很快，会召唤水弹。等她召唤完的间隙再上。',
      steps: [
        { type: 'boss', target: 'shio_no_onna', text: '击败潮の女' }
      ],
      rewards: { exp: 780, gold: 500 },
      nextId: 'hbr_05'
    },

    hbr_05: {
      id: 'hbr_05',
      region: 'harbor', chapter: 5,
      title: '把牌子还回去',
      giver: 'npc_amimoto',
      brief: '那块木牌终于能还回海里了。回去找与一。',
      hint: '与一在栈桥口。',
      steps: [
        { type: 'talk', target: 'npc_amimoto', text: '向与一复命' }
      ],
      rewards: { exp: 380, gold: 300 },
      nextId: null
    },

    // =====================================================================
    // 渚主线：沙滩（4 章）
    //
    // 主题：「有些东西是海送回来的，不是被夺走的」
    // 老人每天在海边等，等的东西玩家要帮他找到——最后发现是一段记忆。
    // =====================================================================
    bch_01: {
      id: 'bch_01',
      region: 'beach', chapter: 1,
      title: '拾贝的老人',
      giver: 'npc_umibe',
      brief: '老人在海边捡了四十年贝壳。他说最近捡到的东西不太对。',
      hint: '沙滩上的礁石缝里躲着河童。',
      steps: [
        { type: 'kill', target: 'kappa', count: 3, text: '赶走礁石边的河童' }
      ],
      rewards: { exp: 140, gold: 100 },
      nextId: 'bch_02'
    },

    bch_02: {
      id: 'bch_02',
      region: 'beach', chapter: 2,
      title: '海送回来的',
      giver: 'npc_umibe',
      brief: '老人说他每天捡到同一枚贝壳，上面刻着名字。他想知道是谁。',
      hint: '沙滩上有三处碑文，记着被海带走的人。',
      steps: [
        { type: 'reach', target: 'stele_beach_1', text: '读沙滩上的碑文' }
      ],
      rewards: { exp: 150, gold: 110 },
      nextId: 'bch_03'
    },

    bch_03: {
      id: 'bch_03',
      region: 'beach', chapter: 3,
      title: '夜里的灯',
      giver: 'npc_umibe',
      brief: '碑上刻的是老人自己的名字。他要你帮他确认一件事——他是不是已经死了。',
      hint: '夜里的沙滩有鬼火。它们或许是答案。',
      steps: [
        { type: 'kill', target: 'onibi', count: 4, text: '追上夜里的鬼火' }
      ],
      rewards: { exp: 250, gold: 170 },
      nextId: 'bch_04'
    },

    bch_04: {
      id: 'bch_04',
      region: 'beach', chapter: 4,
      title: '潮の底',
      giver: 'npc_umibe',
      brief: '老人说他记起来了。那扇门后面有他一直在等的东西。',
      hint: '沙滩南端的潮の淵。走到底。',
      steps: [
        { type: 'boss', target: 'shio_no_onna', text: '走到潮の渊底' }
      ],
      rewards: { exp: 760, gold: 480 },
      nextId: 'bch_05'
    },

    bch_05: {
      id: 'bch_05',
      region: 'beach', chapter: 5,
      title: '贝壳',
      giver: 'npc_umibe',
      brief: '把那枚贝壳还给老人。他等这个等了四十年。',
      hint: '老人在沙滩中部。',
      steps: [
        { type: 'talk', target: 'npc_umibe', text: '把那枚贝壳还给老人' }
      ],
      rewards: { exp: 400, gold: 320 },
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
      giver: 'npc_chie',
      // 章节顺序（用于日志 UI 分组与"当前第几章"显示）
      order: ['town_01', 'town_02', 'town_03', 'town_04', 'town_05', 'town_06']
    },
    mountain: {
      region: 'mountain',
      name: '神山',
      startId: 'mtn_01',
      giver: 'npc_kannushi',
      order: ['mtn_01', 'mtn_02', 'mtn_03', 'mtn_04', 'mtn_05']
    },
    harbor: {
      region: 'harbor',
      name: '湊町',
      startId: 'hbr_01',
      giver: 'npc_amimoto',
      order: ['hbr_01', 'hbr_02', 'hbr_03', 'hbr_04', 'hbr_05']
    },
    beach: {
      region: 'beach',
      name: '渚',
      startId: 'bch_01',
      giver: 'npc_umibe',
      order: ['bch_01', 'bch_02', 'bch_03', 'bch_04', 'bch_05']
    }
  };

  /**
   * 按地区取主线起点 id（供 UI / 调试用）
   */
  G.DATA.questLineStart = function (region) {
    var l = G.DATA.QUEST_LINES[region];
    return l ? l.startId : null;
  };

  // npc -> 对话 id 的映射在 data/zones.js 的 NPCS 里
  G.DATA.DIALOGUE_BY_QUEST = {};

})(window.G = window.G || {});
