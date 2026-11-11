/* data/quests.js — 任务
 */
(function (G) {
  'use strict';
  G.DATA = G.DATA || {};

  G.DATA.QUESTS = {
    main_01: {
      id: 'main_01',
      title: '系上三处结',
      giver: 'npc_chie',
      brief: '去霞ヶ原，把断掉的三处结系上。',
      steps: [
        { type: 'knot', target: 'knot_1', text: '系上溪边的结' },
        { type: 'knot', target: 'knot_2', text: '系上竹林尽头的结' },
        { type: 'knot', target: 'knot_3', text: '系上社前的结' }
      ],
      rewards: { exp: 120, gold: 80 },
      nextId: 'main_02'
    },
    main_02: {
      id: 'main_02',
      title: '飛刃',
      giver: 'npc_chie',
      brief: '三处结都系上了。回去找千絵。',
      steps: [
        { type: 'talk', target: 'npc_chie', text: '向千絵复命' }
      ],
      rewards: { exp: 80, gold: 40, unlockSkill: 3 },
      nextId: 'main_03'
    },
    main_03: {
      id: 'main_03',
      title: '忘れ緒の社',
      giver: 'npc_chie',
      brief: '社里还有最后一处结。去把它系上。',
      steps: [
        { type: 'reach', target: 'gate_dungeon', text: '走到社前' }
      ],
      rewards: { exp: 150, gold: 100, unlockSkill: 4 },
      nextId: null
    },
    side_01: {
      id: 'side_01',
      title: '灯守的请求',
      giver: 'npc_roji',
      brief: '替ろじ带 3 份鬼火之灰回来。',
      steps: [
        { type: 'collect', target: 'mat_ember', count: 3, text: '收集鬼火之灰' }
      ],
      rewards: { exp: 60, gold: 50 },
      nextId: null
    }
  };

  // npc -> 对话 id 的映射在 data/zones.js 的 NPCS 里
  G.DATA.DIALOGUE_BY_QUEST = {
    main_02: 'd_chie_intro'
  };

})(window.G = window.G || {});
