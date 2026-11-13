/* 51-terrain.js — 地形高度场（多区域版 v2）
 *
 * 【v1 的失败教训，值得留着】
 * 第一版我用"多区域权重混合"：每个区域算出自己的高度，再按距离权重加权平均。
 * 实测交界处出现 17~18 单位的高度断层（相当于一堵悬崖），原因有三：
 *   1) 相邻区域的高度基线差太多（平野 z=70 处高 10.2，码头只有 1.8），
 *      加权平均在两个区域都占 30% 的位置会得到 ~5，但一旦权重偏向某边就跳到 1.8 或 10.2
 *   2) 区域权重都趋近 0 的"空隙"里归一化除极小数，数值爆炸
 *   3) 椭圆区域之间必然有空隙，空隙处无定义
 *
 * v2 的策略彻底换掉了：
 *   **先定义一个连续的全局基础地形，再把局部特征（山、海、溪）作为"可加/可限制"的修饰叠加。**
 *   这样任何位置都有明确定义，且天然连续——因为基础地形本身就是平滑函数。
 *
 * 具体做法：
 *   base(x,z) = 从南到北的整体地势（城镇处刚好为 0）
 *   然后：
 *     - 神山：在基础之上**加上**一个高斯状的山体隆起（永远只会往上堆，不会和别处打架）
 *     - 海岸：在基础之上**减去**一个朝东倾斜的量，并 clamp 到海平面以下
 *     - 溪谷：局部下切
 *   最后整平城镇。
 *   全是"加法/乘法"，没有除法归一化，所以不会爆。
 */
(function (G) {
  'use strict';

  var T = G.terrain = {};

  // =====================================================================
  // 区域参数（供刷怪/地名/物件摆放查询用）
  // =====================================================================
  var REGIONS = {
    // 城镇：椭圆要**覆盖整个 TOWN 矩形**（含四角），
    // 否则 regionAt((13,15)) 会和 field 打平甚至判给 field。
    // TOWN 是 60×44（半宽 30 / 半深 22），四角距离 = √(30²+22²) ≈ 37.2。
    // rx/rz 取 30/26 时，(30,22) 的归一化距离是 √(1 + 0.72) ≈ 1.31 > 1，
    // 会判成 field —— NPC 就被归到错误区域了。
    // 取 36/30 让四角都落在 1.0 以内。
    town:     { cx: 0,    cz: 0,    rx: 36,  rz: 30 },
    field:    { cx: 0,    cz: 40,   rx: 48,  rz: 40 },
    // 山的中心要在峰顶，rz 要够大让山脚平缓延伸到 z=90 左右。
    // 【踩过的坑】原来 cz=150, rz=56，山体在 z=206 处才归零，
    // 但玩家走到 z=170 时 hillTop 已经掉了 40%（从 41 降到 24），
    // 看起来像"爬过山顶又下山"，实际是椭圆边界截断。
    // 现在 cz=140, rz=72：峰顶在 z=140，山脚延伸到 z=212。
    mountain: { cx: 0,    cz: 140,  rx: 66,  rz: 72 },
    // 海岸区域要覆盖到"海里"
    harbor:   { cx: 120,  cz: 62,   rx: 42,  rz: 34 },
    beach:    { cx: 150,  cz: 130,  rx: 78,  rz: 66 }
  };
  T.REGIONS = REGIONS;

  var TOWN_PAD = 6;

  function normDist(r, x, z) {
    var dx = (x - r.cx) / r.rx;
    var dz = (z - r.cz) / r.rz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** 高斯状隆起：中心 1，边缘平滑到 0（不会突变） */
  function bump(x, z, r, power) {
    var d = normDist(r, x, z);
    if (d >= 1) return 0;
    var t = 1 - d;
    return Math.pow(t, power || 2);
  }

  // =====================================================================
  // 1) 全局基础地形：从南到北的整体地势
  //
  // 要求：连续、无除法、城镇处为 0。
  // 用 smoothstep 拼接几段高度，段与段之间用 smoothstep 过渡，不会有台阶。
  // =====================================================================
  function baseHeight(x, z) {
    // 南北向的整体抬升：z=0 时 0，z=60 时约 6，z=110 时约 9
    var north = G.M.smoothstep(G.M.clamp01(z / 110)) * 9.0;

    // 东西向的轻微盆地（中间是走道，两侧略高）
    var bowl = Math.pow(Math.abs(x) / 60, 2) * 2.2;

    // 细节噪声（两个频率，幅度小）
    var wobble = Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.35
               + Math.sin(x * 0.41 + 1.3) * 0.14;

    return north + bowl + wobble;
  }

  // =====================================================================
  // 2) 神山：叠加式隆起（只会往上加，永远不冲突）
  // =====================================================================
  function mountainAdd(x, z) {
    var r = REGIONS.mountain;

    // 主山体：中心高 34，用较高次幂让山脚缓、山顶尖
    var core = bump(x, z, r, 1.8) * 34;

    // 三道山脊台阶（让山体有层次，不是光滑馒头）
    // 用 sin 制造环状的"等高线台阶"，再乘以权重让它只在山体范围内生效
    var ridgeMask = bump(x, z, r, 2.5);
    var ridge = Math.sin(normDist(r, x, z) * Math.PI * 6) * 1.6 * ridgeMask;

    // 山道：x≈0 处地势略平（可走），用减法降低
    var pathMask = G.M.smoothstep(Math.abs(x) / 12) * bump(x, z, r, 2.0);
    var path = pathMask * 3.0;

    return core + ridge + path;
  }

  // =====================================================================
  // 3) 海岸：把海滨区域整体压平成"低平台地 + 入海缓坡"
  //
  // 【v2 第一次修正】原来只用 -eastDrop 做减法，但 baseHeight 的 north 项
  // 在 z=74 处已经贡献了 6 单位、z=140 处 9 单位，减法抵不过，
  // 结果码头 h=13.8、沙滩海边 h=21.5（本该在水下）。
  // 正确做法：沿海区域不是"减法"，而是"把高度**替换**成海岸剖面"，
  // 用 weight 在原高度与海岸剖面之间插值。
  // =====================================================================
  function coastProfile(x, z) {
    var r = REGIONS.beach;
    var rh = REGIONS.harbor;

    var wBeach = bump(x, z, r, 1.0);
    var wHarbor = bump(x, z, rh, 1.0);
    var w = Math.max(wBeach, wHarbor);
    if (w <= 0) return { h: null, w: 0 };

    // 海岸剖面：西高东低
    //   x < 88   -> +2.4（内陆台地，接平野）
    //   x = 118  ->  0  （海岸线，潮间带）
    //   x > 150  -> -2.4（海床）
    var t = G.M.clamp01((x - 88) / 62);
    var h = G.M.lerp(2.4, -2.4, t);

    // 沙滩细节：沙丘与潮痕
    var dune = Math.sin(z * 0.19 + 0.7) * 0.28 + Math.sin(x * 0.23) * 0.18;
    h += dune * 0.5;

    // 码头区域保持更平整（要放建筑与码头栈桥）
    if (wHarbor > wBeach) {
      h = G.M.lerp(h, 1.6, wHarbor * 0.85);
    }

    return { h: h, w: w };
  }

  // =====================================================================
  // 4) 溪谷（保留原逻辑，只在平野区域生效）
  // =====================================================================
  var RIVER = { centerX: -22, halfWidth: 3.6, depth: 2.2, zMin: 14, zMax: 56 };
  T.river = RIVER;

  function riverCarve(x, z) {
    if (z < RIVER.zMin || z > RIVER.zMax) return 0;
    var dx = Math.abs(x - RIVER.centerX);
    if (dx > RIVER.halfWidth) return 0;
    var t = 1 - dx / RIVER.halfWidth;
    var shape = G.M.smoothstep(t);
    var zFade = Math.min(
      G.M.smoothstep((z - RIVER.zMin) / 3),
      G.M.smoothstep((RIVER.zMax - z) / 3)
    );
    return -RIVER.depth * shape * zFade;
  }

  // =====================================================================
  // 城镇整平权重
  // =====================================================================
  function townWeight(x, z) {
    // 城镇用矩形（和 zones.js 的 TOWN 对齐），外扩 TOWN_PAD 做过渡
    //
    // 【语义】返回值 = "这个点应该被拉平到什么程度"
    //   1 = 完全拉平（城镇内部 + 过渡带内侧）
    //   0 = 完全不受城镇影响（离城镇足够远）
    //
    // 【踩过的坑】原来写成 `smoothstep(d / TOWN_PAD)`，其中 d 是到边界的距离。
    // 这导致城镇**靠边的地方**只被拉平一部分 —— 实测 (28,20) 处
    // 地面高度是 1.03 而不是 0，NPC 会悬空。
    // 正确语义：边界**内部**一律 1（绝对平坦），只有**外部**才做过渡。
    var D = G.DATA.TOWN;
    var dx = Math.min(x - D.minX, D.maxX - x);   // 到左右边界的距离（内部为正）
    var dz = Math.min(z - D.minZ, D.maxZ - z);   // 到上下边界的距离
    var d = Math.min(dx, dz);

    // 城镇内部：完全拉平
    if (d >= 0) return 1;

    // 城镇外部：按距离做过渡带
    var outside = -d;
    if (outside >= TOWN_PAD) return 0;
    return 1 - G.M.smoothstep(outside / TOWN_PAD);
  }

  // =====================================================================
  // 主高度函数：全部是加法/乘法，无除法归一化
  // =====================================================================
  T.height = function (x, z) {
    var base = baseHeight(x, z);
    var h = base;

    // 山：往上堆
    h += mountainAdd(x, z);

    // 海岸：用"剖面替换"而不是减法（详见 coastProfile 的注释）
    //
    // 【踩过的坑：海滩路上有 10 单位断层】
    // 原来用 smoothstep(w * 1.6) 做插值权重。w=0.4 时权重只有 0.36，
    // 于是内陆高值（10.9）与海岸剖面（0.9）之间还有一个"半高"的中间态，
    // 但相邻采样点 w 变化快，导致 20 单位距离内高度从 10.9 掉到 0.94。
    // 修法：把 w 先做一次 smoothstep 拉伸，让"快速衰减带"变宽，
    // 同时用 w 本身的平方根让小权重也产生足够的替换力。
    var coast = coastProfile(x, z);
    if (coast.w > 0 && coast.h !== null) {
      var cw = Math.sqrt(G.M.clamp01(coast.w));          // 小权重也能拉动
      cw = G.M.smoothstep(G.M.clamp01(cw * 1.3));        // 再平滑一次
      h = G.M.lerp(h, coast.h, cw);
    }

    // 溪谷：局部下切
    h += riverCarve(x, z);

    // 城镇整平：向 0 插值
    var tw = townWeight(x, z);
    if (tw > 0) {
      h = h * (1 - tw);
    }

    return h;
  };

  /** 坡度（有限差分） */
  T.slope = function (x, z) {
    var e = 0.5;
    var hl = T.height(x - e, z), hr = T.height(x + e, z);
    var hd = T.height(x, z - e), hu = T.height(x, z + e);
    return { dx: (hr - hl) / (2 * e), dz: (hu - hd) / (2 * e) };
  };

  T.steepness = function (x, z) {
    var s = T.slope(x, z);
    return Math.sqrt(s.dx * s.dx + s.dz * s.dz);
  };

  /** 海平面 */
  T.seaLevel = function () { return -0.8; };

  /** 溪流水位 */
  T.waterLevel = function () { return -1.15; };

  T.isUnderwater = function (x, z) {
    var h = T.height(x, z);
    var r = REGIONS;
    var atSea = bump(x, z, r.beach, 1.0) > 0.02 || bump(x, z, r.harbor, 1.0) > 0.02;
    var level = atSea ? T.seaLevel() : T.waterLevel();
    return h < level;
  };

  /** 某点所属区域（取最近的区域中心） */
  T.regionAt = function (x, z) {
    var best = 'field', bestD = 1e9;
    for (var k in REGIONS) {
      var d = normDist(REGIONS[k], x, z);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  };

})(window.G = window.G || {});
