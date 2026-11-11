/* 90-arch.js — 世界状态 / 玩家意图 分层（为将来联机预留）
 *
 * v0.1 里 dispatch 是同步本地调用。
 * 将来接 WebSocket：把 dispatch 换成"发到服务端 + 等权威 state 回包"，
 * 游戏逻辑一行都不用改 —— 这就是 Q2 选 A（只留架构）的全部落地方式。
 */
(function (G) {
  'use strict';

  var A = G.arch = {};

  // ---------- 世界状态（唯一真相） ----------
  // 注意：v0.1 的状态分散在各个子模块里（player.state / world.* / enemy.list），
  // 这里只提供一个统一的"意图入口"。真的迁移到权威服务端时，
  // 把下面这些 intent handler 搬到服务端即可。
  A.intents = {};

  /**
   * 注册一个意图处理器。
   * @param {string} type
   * @param {function} handler
   */
  A.on = function (type, handler) {
    A.intents[type] = handler;
  };

  /**
   * 派发一个玩家意图（v0.1：同步执行；v0.2+：走网络）
   * @param {string} type
   * @param {object} payload
   */
  A.dispatch = function (type, payload) {
    payload = payload || {};
    payload.type = type;
    payload.clientSeq = (A._seq = (A._seq || 0) + 1);
    payload.clientTime = Date.now();

    var h = A.intents[type];
    if (!h) {
      // 没有注册的意图不报错：v0.1 允许直接调用
      return null;
    }
    return h(payload);
  };

  // ---------- 已注册的意图 ----------
  // 这些是将来需要"服务端权威"的操作，v0.1 里本地执行。

  A.on('player.move', function (p) {
    var st = G.player.state;
    st.x = p.x; st.z = p.z;
  });

  A.on('player.attack', function (p) {
    // 由 40-player.js 直接调，这里只留接口
  });

  A.on('enemy.damage', function (p) {
    var e = G.enemy.list.find(function (x) { return x.id === p.id; });
    if (e) G.combat.hitEnemy(e, p.amount, p);
  });

  A.on('loot.pickup', function (p) {
    // 由 60-inventory.js 直接处理
  });

  A.on('world.time', function (p) {
    G.world.timeOfDay = p.timeOfDay;
  });

})(window.G = window.G || {});
