/* 51-terrain.js — 地形高度场
 *
 * 设计原则（很重要）：
 *  1) 高度必须是一个**纯函数** h(x,z)，任何模块随时可查，不需要查询网格。
 *  2) 城镇区域保持绝对平坦（h=0）——城镇是安全区，台阶/坡度会让 NPC 和
 *     建筑对位变得脆弱，且视觉上城镇平整更像"人工聚落"。
 *  3) 野外用几个"地形骨架"叠加：缓坡 + 溪谷下切 + 远处高地。
 *  4) 高度函数必须是**连续可导**的（smoothstep 过渡），否则实体会在
 *     硬边处"跳"一格。
 */
(function (G) {
  'use strict';

  var T = G.terrain = {};

  // 城镇范围（沿用 DATA.TOWN 的边界，向内收 2 单位作为过渡带）
  var TOWN_PAD = 2.5;

  /**
   * 城镇权重 0..1。
   * 城镇内 = 1（完全平整），过渡带内平滑衰减到 0。
   */
  function townWeight(x, z) {
    var D = G.DATA.TOWN;
    // 到城镇矩形边界的有符号距离（内部为正）
    var dx = Math.min(x - D.minX, D.maxX - x);
    var dz = Math.min(z - D.minZ, D.maxZ - z);
    var d = Math.min(dx, dz);
    if (d <= 0) return 0;                       // 城外
    if (d >= TOWN_PAD) return 1;                // 城内深处
    return G.M.smoothstep(d / TOWN_PAD);        // 过渡带
  }

  /**
   * 野外基础起伏：从城镇边界往北缓升，配合两道横向的"坡坎"。
   */
  function fieldHeight(x, z) {
    // 北高南低：越往副本方向越高
    var rise = G.M.clamp01((z - 12) / 54) * 6.2;

    // 第一道坡坎：z≈26，缓坡
    var step1 = G.M.smoothstep((z - 22) / 8) * 1.5;

    // 第二道坡坎：z≈48，更陡
    var step2 = G.M.smoothstep((z - 44) / 7) * 2.4;

    // 东西两侧略微抬升（盆地感，中间是走道）
    var bowl = Math.pow(Math.abs(x) / 34, 2.2) * 2.8;

    // 细微噪声（用两个不同频率的正弦代替，避免引入额外随机性）
    var wobble = Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.35
               + Math.sin(x * 0.53 + 1.7) * 0.12;

    return rise + step1 + step2 + bowl + wobble;
  }

  /**
   * 溪谷下切：沿 x≈-22 的一条南北向沟。
   * 用平滑的谷形（不是 V 字），并让水面高度跟随。
   */
  var RIVER = { centerX: -22, halfWidth: 3.6, depth: 2.2, zMin: 14, zMax: 56 };

  function riverCarve(x, z) {
    if (z < RIVER.zMin || z > RIVER.zMax) return 0;
    var dx = Math.abs(x - RIVER.centerX);
    if (dx > RIVER.halfWidth) return 0;
    // 谷形：中心最深，边缘平滑到 0
    var t = 1 - dx / RIVER.halfWidth;
    var shape = G.M.smoothstep(t);
    // 南北两端淡出
    var zFade = Math.min(
      G.M.smoothstep((z - RIVER.zMin) / 3),
      G.M.smoothstep((RIVER.zMax - z) / 3)
    );
    return -RIVER.depth * shape * zFade;
  }

  /**
   * 主高度函数。
   * @returns {number} 世界 y（地面表面）
   */
  T.height = function (x, z) {
    var tw = townWeight(x, z);
    // 城镇内强制 0；过渡带内插值
    var field = fieldHeight(x, z) + riverCarve(x, z);
    return field * (1 - tw);
  };

  /** 地面法线（用于让物体贴合坡面，目前只用于立绘的轻微倾斜） */
  T.slope = function (x, z) {
    var e = 0.5;
    var hl = T.height(x - e, z), hr = T.height(x + e, z);
    var hd = T.height(x, z - e), hu = T.height(x, z + e);
    return {
      dx: (hr - hl) / (2 * e),
      dz: (hu - hd) / (2 * e)
    };
  };

  /** 坡度大小 0..~（0=平地） */
  T.steepness = function (x, z) {
    var s = T.slope(x, z);
    return Math.sqrt(s.dx * s.dx + s.dz * s.dz);
  };

  /** 河流中心线（供水面与碰撞使用） */
  T.river = RIVER;

  /** 水面高度：溪谷中心的固定水位 */
  T.waterLevel = function () {
    return -1.15;
  };

  /** 判断某点是否在水下（用于减速） */
  T.isUnderwater = function (x, z) {
    return T.height(x, z) < T.waterLevel();
  };

})(window.G = window.G || {});
