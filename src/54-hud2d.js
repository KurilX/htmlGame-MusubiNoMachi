/* 54-hud2d.js — 2D 模式的 HUD 桥接
 *
 * 【为什么需要】
 * 2D 模式不构建 3D 世界，所以没有 G.player（那是 3D 玩家模块）。
 * 但 HUD（src/70-ui.js）的 update() 直接读 G.player.state 的
 * hp / maxHp / exp / level 等字段 —— 没有它就 return，HUD 一片空白。
 *
 * 本文件提供 G.player.state 的**最小替身**，让现有 HUD 直接可用，
 * 不用改 70-ui.js（它还有 3D 路线在用，不能动）。
 *
 * 【设计原则】
 *   - 只提供 HUD 真正读的字段
 *   - 数值来自 2D 玩家，后续接真实战斗时再扩展
 */
(function (G) {
  'use strict';

  var H = G.hud2d = {};

  /** 建立 G.player 替身（幂等） */
  H.bind = function () {
    if (G.player && G.player.state) {
      // 3D 路线已经建过，不动它
      return G.player.state;
    }

    G.player = G.player || {};

    G.player.state = {
      // ---- HUD 读取的字段 ----
      hp: 100,
      maxHp: 100,
      exp: 0,
      expNext: 100,
      level: 1,
      lv: 1,                    // 有些地方用 lv
      name: '旅人',
      money: 0,
      gold: 0,                  // 兼容
      stamina: 100,
      maxStamina: 100,

      // ---- 位置（HUD 的小地图/坐标可能用）----
      x: 0,
      y: 0,
      z: 0,

      // ---- 战斗态（2D 版暂无战斗）----
      dead: false,
      dodgeCd: 0,
      invuln: 0,

      // ---- 技能冷却占位 ----
      cds: [0, 0, 0, 0],

      // ---- 标记来源，便于调试 ----
      __is2dStub: true
    };

    // HUD 里会调用的一些方法，给个空实现避免报错
    G.player.isDead = function () { return !!G.player.state.dead; };
    G.player.hp = function () { return G.player.state.hp; };
    G.player.maxHp = function () { return G.player.state.maxHp; };

    return G.player.state;
  };

  /** 让 2D 玩家的位置同步到替身 state（HUD 可能需要） */
  H.sync = function () {
    var st = G.player && G.player.state;
    var p = G.world2d && G.world2d.player;
    if (!st || !p || !st.__is2dStub) return;
    st.x = p.x;
    st.y = p.y;
    st.z = 0;
  };

  /** 初始化 HUD（如果还没建） */
  H.init = function () {
    H.bind();
    if (!G.ui) return false;

    try {
      if (!G.ui.root) G.ui.init();
      return true;
    } catch (e) {
      console.warn('[hud2d] UI 初始化失败:', e && e.message);
      return false;
    }
  };

  /** 每帧更新 HUD */
  H.update = function (dt) {
    H.sync();
    if (G.ui && G.ui.update) {
      try { G.ui.update(dt); } catch (e) { /* 静默，别拖垮主循环 */ }
    }
  };

})(window.G = window.G || {});
