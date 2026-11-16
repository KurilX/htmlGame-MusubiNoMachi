/* 62-intro.js — 开场引导
 *
 * 【为什么需要这个文件】
 * 之前为了让玩家"不用先找 NPC 就知道干什么"，我在开局直接
 * `G.quest.start('town_01')` 自动接第一个任务。
 *
 * 这是个设计错误：玩家一睁眼就多了个「击退鬼火」的目标，
 * 既没有开场、也没见过千絵、更不知道自己是誰。
 * 跳过剧情直接给任务单，等于把 RPG 的入口砍掉了。
 *
 * 【现在的做法】三层引导，**不让玩家凭空接任务**：
 *
 *  1) 开场独白（纯旁白，不接任务）
 *     出生时黑屏渐入 + 三行旁白，交代"你是谁、这是哪、你为什么在这"。
 *
 *  2) 引导目标：去找千絵（reach 型软目标，不占任务栏）
 *     追踪 HUD 显示「去鸟居下找千絵」，玩家不会两眼一抹黑。
 *
 *  3) 走到千絵面前 → 自动触发对话 → 对话结束才接第一个任务
 *     任务由剧情带出，不是系统硬塞。
 *
 * 只有**全新存档**才走这套流程（读档/已完成过的人不重复看）。
 */
(function (G) {
  'use strict';

  var I = G.intro = {};

  // 当前阶段
  //   0 = 未开始
  //   1 = 开场独白中
  //   2 = 等待玩家走到千絵面前
  //   3 = 已完成（不再干预）
  I.stage = 0;

  // 引导目标（不写进任务系统，只驱动追踪 HUD）
  I.objective = null;

  // 千絵触发半径
  var CHIE_RADIUS = 3.2;

  // 轮询节流
  var pollTimer = 0;
  var POLL_INTERVAL = 0.3;

  // 开场旁白
  var OPENING_LINES = [
    '（你在一座鸟居下醒来。不知道躺了多久。）',
    '（手里握着一枚绳结。你不记得是谁给的。）',
    '（前面有个人在等你。她一直在看你。）'
  ];

  /**
   * 是否需要播开场。
   * 只有"全新存档"（没有任何任务进度）才播。
   */
  I.shouldPlay = function () {
    if (!G.quest) return false;
    for (var a in G.quest.state.active) { if (a) return false; }
    for (var d in G.quest.state.done) { if (d) return false; }
    return true;
  };

  /**
   * 播开场独白。
   * 用对话系统播（但 speaker 为空 = 旁白），结束后不接任务，
   * 只把引导目标设为"去找千絵"。
   */
  I.playOpening = function () {
    if (I.stage !== 0) return;
    I.stage = 1;

    // 黑屏渐入：先盖一层黑，再淡出，让"醒来"有过程
    I._fadeIn(function () {
      if (G.dlg) {
        G.dlg.start(null, {
          id: 'd_opening',
          speaker: '',
          lines: OPENING_LINES,
          onEnd: function () {
            I.stage = 2;
            I.objective = '去找千絵';
            if (G.ui.invalidateTracker) G.ui.invalidateTracker();
            G.ui.toast('走到鸟居下的千絵面前', 3600);
          }
        });
      } else {
        // 对话系统不可用时降级：直接进阶段 2
        I.stage = 2;
        I.objective = '去找千絵';
      }
    });
  };

  /** 黑屏渐入 */
  I._fadeIn = function (done) {
    var ov = document.getElementById('introFade');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'introFade';
      ov.style.cssText = [
        'position:fixed', 'inset:0', 'background:#0A0810',
        'z-index:9000', 'pointer-events:none',
        'opacity:1', 'transition:opacity 1.6s ease-out'
      ].join(';');
      document.body.appendChild(ov);
    }
    ov.style.opacity = '1';

    // 等一帧让初始 opacity 生效，再淡出
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ov.style.opacity = '0';
        setTimeout(function () {
          // 淡出完成后再开对话，玩家能看清画面
          if (ov.parentNode) ov.parentNode.removeChild(ov);
          if (done) done();
        }, 1700);
      });
    });
  };

  /**
   * 每帧调用：检测玩家是否走到千絵面前。
   * 到了就自动触发对话（不用按 E，避免玩家不知道该按什么）。
   */
  I.update = function (dt, player) {
    if (I.stage !== 2 || !player) return;

    pollTimer -= dt;
    if (pollTimer > 0) return;
    pollTimer = POLL_INTERVAL;

    // 对话中不触发
    if (G.dlg && G.dlg.active) return;

    var chie = (G.world.npcs || []).find(function (n) {
      return n.def && n.def.id === 'npc_chie';
    });
    if (!chie) return;

    var dx = chie.x - player.x;
    var dz = chie.z - player.z;
    if (dx * dx + dz * dz > CHIE_RADIUS * CHIE_RADIUS) return;

    // 到位了：自动开对话，任务由对话的 onEnd 派发
    I.stage = 3;
    I.objective = null;
    if (G.ui.invalidateTracker) G.ui.invalidateTracker();

    if (G.dlg) {
      G.dlg.start(chie, G.DATA.DIALOGUES['d_chie_intro']);
    } else if (G.quest) {
      // 对话系统异常时的兜底：至少把任务接上
      G.quest.start('town_01');
    }
  };

  /** 追踪 HUD 用：开场引导目标（优先级高于任务） */
  I.currentObjective = function () {
    return I.objective;
  };

  /** 重置（读档到另一个存档时用） */
  I.reset = function () {
    I.stage = 0;
    I.objective = null;
    pollTimer = 0;
    var ov = document.getElementById('introFade');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  };

})(window.G = window.G || {});
