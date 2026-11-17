/* 52-world2d.js — 2D 瓦片世界（結ノ町城镇）
 *
 * 【这是什么】
 * 一个真正的 2D 瓦片地图世界。没有 3D 相机、没有高度、没有深度缓冲。
 *
 * 【地图表示】
 *   cols × rows 的二维数组，每格存瓦片名（字符串）。
 *   渲染时按格子 drawImage，天然不会穿透。
 *
 * 【与旧世界的关系】
 * 旧世界（src/50-world.js，3D）**保留不动**，主菜单/存档/任务都还依赖它的数据。
 * 本文件是并行的 2D 实现，通过 ?mode=2d 启用。
 * 等 2D 版验证通过后，再逐步迁移数据。
 */
(function (G) {
  'use strict';

  var W2 = G.world2d = {};

  W2.TILE = 32;          // 一格 32 屏幕像素（16px 素材 × 2 倍）

  W2.map = null;         // { cols, rows, ground: [], deco: [], solid: [] }
  W2.player = null;      // { x, y, dir, frame, animT, moving }
  W2.npcs = [];

  // =====================================================================
  // 构建結ノ町城镇地图
  // =====================================================================
  //
  // 布局（保持原有地理概念：城镇是中心，往北是鸟居和野外）
  //   ┌─────────────────────────────┐
  //   │  草地 / 外围                │
  //   │   ┌───────┐   ┌───────┐    │  ← 房屋
  //   │   │ 房1   │   │ 房2   │    │
  //   │   └───────┘   └───────┘    │
  //   │        ── 主路 ──           │
  //   │   ┌───────┐   ┌───────┐    │
  //   │   │ 房3   │   │ 房4   │    │
  //   │   └───────┘   └───────┘    │
  //   │        鸟居（北出口）        │
  //   └─────────────────────────────┘
  W2.buildTown = function () {
    var COLS = 40, ROWS = 30;
    var ground = new Array(COLS * ROWS);
    var deco = new Array(COLS * ROWS);
    var solid = new Array(COLS * ROWS);   // 碰撞

    function idx(c, r) { return r * COLS + c; }
    function set(arr, c, r, v) {
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
      arr[idx(c, r)] = v;
    }

    // ---- 1. 铺草地（带随机变化，避免死板）----
    var grassVariants = ['grass', 'grass2', 'grass3', 'grass4'];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        // 用坐标做伪随机，同一位置永远是同一块（可复现）
        var h = (c * 73856093) ^ (r * 19349663);
        var pick = Math.abs(h) % grassVariants.length;
        set(ground, c, r, grassVariants[pick]);
      }
    }

    // ---- 2. 主路（南北向，从鸟居往南穿过城镇）----
    for (var rr = 2; rr < ROWS - 2; rr++) {
      set(ground, 19, rr, 'dirt');
      set(ground, 20, rr, 'dirt2');
      set(ground, 21, rr, 'dirt');
    }

    // ---- 3. 东西向的街 ----
    for (var cc = 8; cc < 32; cc++) {
      set(ground, cc, 15, 'dirt');
      set(ground, cc, 16, 'dirt2');
    }

    // ---- 4. 四栋房子 ----
    //
    // 每栋 = 屋顶（上方若干行）+ 墙（下方）+ 门
    var houses = [
      { c: 10, r: 6,  w: 6, h: 4 },
      { c: 24, r: 6,  w: 6, h: 4 },
      { c: 10, r: 19, w: 6, h: 4 },
      { c: 24, r: 19, w: 6, h: 4 }
    ];

    houses.forEach(function (h) {
      for (var dy = 0; dy < h.h; dy++) {
        for (var dx = 0; dx < h.w; dx++) {
          var c2 = h.c + dx, r2 = h.r + dy;
          if (dy < h.h - 1) {
            // 屋顶部分
            set(ground, c2, r2, (dy === 0) ? 'roof2' : 'roof');
            set(solid, c2, r2, true);
          } else {
            // 墙 + 门（门开在中间）
            var isDoor = (dx === Math.floor(h.w / 2));
            set(ground, c2, r2, isDoor ? 'floorWood' : 'wall');
            set(solid, c2, r2, !isDoor);
          }
        }
      }
    });

    // ---- 5. 鸟居位置标记（用砖块做柱子）----
    // 北出口两侧各立一根
    set(ground, 18, 2, 'brick'); set(solid, 18, 2, true);
    set(ground, 22, 2, 'brick'); set(solid, 22, 2, true);

    // ---- 6. 装饰：草丛与灌木 ----
    var decoSpots = [
      [4, 4], [7, 5], [15, 3], [28, 4], [34, 6], [3, 12], [36, 10],
      [5, 24], [16, 26], [27, 25], [33, 22], [2, 18], [37, 16],
      [12, 11], [27, 12], [9, 26], [30, 8]
    ];
    decoSpots.forEach(function (p, i) {
      set(deco, p[0], p[1], (i % 3 === 0) ? 'bush' : 'grassTuft');
      if (i % 3 === 0) set(solid, p[0], p[1], true);
    });

    // ---- 7. 边缘：外圈用悬崖草地围起来 ----
    for (var e = 0; e < COLS; e++) {
      set(ground, e, 0, 'cliffGrass');   set(solid, e, 0, true);
      set(ground, e, ROWS - 1, 'cliffGrass'); set(solid, e, ROWS - 1, true);
    }
    for (var e2 = 0; e2 < ROWS; e2++) {
      set(ground, 0, e2, 'cliffGrass');  set(solid, 0, e2, true);
      set(ground, COLS - 1, e2, 'cliffGrass'); set(solid, COLS - 1, e2, true);
    }

    W2.map = {
      cols: COLS, rows: ROWS,
      ground: ground,
      deco: deco,
      solid: solid
    };

    // ---- 8. 玩家初始位置：主路上，房子之间 ----
    W2.player = {
      x: 20 * W2.TILE + W2.TILE / 2,
      y: 13 * W2.TILE + W2.TILE / 2,
      dir: 0,
      frame: 0,
      animT: 0,
      moving: false,
      speed: 130
    };

    // ---- 9. NPC：4 个，站在房子门口与路旁 ----
    W2.npcs = [
      { x: 13 * W2.TILE, y: 12 * W2.TILE, dir: 0, name: '千絵' },
      { x: 27 * W2.TILE, y: 12 * W2.TILE, dir: 0, name: '鉄次' },
      { x: 12 * W2.TILE, y: 25 * W2.TILE, dir: 1, name: '杏' },
      { x: 28 * W2.TILE, y: 25 * W2.TILE, dir: 1, name: 'ろじ' }
    ];

    return W2.map;
  };

  // =====================================================================
  // 碰撞
  // =====================================================================
  W2.isSolidAt = function (worldX, worldY) {
    var m = W2.map;
    if (!m) return false;
    var c = Math.floor(worldX / W2.TILE);
    var r = Math.floor(worldY / W2.TILE);
    if (c < 0 || c >= m.cols || r < 0 || r >= m.rows) return true;

    // 显式碰撞标记
    if (m.solid[r * m.cols + c]) return true;

    // 或者瓦片本身不可通行
    var g = m.ground[r * m.cols + c];
    return !G.tiles16.isWalkable(g);
  };

  // =====================================================================
  // 更新（移动 + 动画）
  // =====================================================================
  W2.update = function (dt, input) {
    var p = W2.player;
    if (!p) return;

    var ax = 0, ay = 0;
    if (input.keys.left) ax -= 1;
    if (input.keys.right) ax += 1;
    if (input.keys.up) ay -= 1;
    if (input.keys.down) ay += 1;

    // 归一化（对角线不加速）
    if (ax !== 0 && ay !== 0) {
      var inv = Math.SQRT1_2;
      ax *= inv; ay *= inv;
    }

    p.moving = (ax !== 0 || ay !== 0);

    if (p.moving) {
      // 朝向：以水平/垂直分量决定（4 方向）
      if (Math.abs(ax) > Math.abs(ay)) {
        p.dir = (ax > 0) ? 3 : 2;   // 右 / 左
      } else {
        p.dir = (ay > 0) ? 0 : 1;   // 下 / 上
      }

      var nx = p.x + ax * p.speed * dt;
      var ny = p.y + ay * p.speed * dt;

      // 分轴碰撞（可以沿墙滑动）
      if (!W2.isSolidAt(nx, p.y)) p.x = nx;
      if (!W2.isSolidAt(p.x, ny)) p.y = ny;

      // 行走动画：6 帧循环
      p.animT += dt;
      p.frame = 1 + (Math.floor(p.animT * 8) % 6);
    } else {
      p.animT = 0;
      p.frame = 0;
    }

    // NPC 朝向玩家（简单的雷达式）
    W2.npcs.forEach(function (n) {
      var dx = p.x - n.x, dy = p.y - n.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        n.dir = (dx > 0) ? 3 : 2;
      } else {
        n.dir = (dy > 0) ? 0 : 1;
      }
    });

    // 相机跟随
    if (G.render2d) {
      G.render2d.camFollow(p.x, p.y);
    }
  };

  // =====================================================================
  // 绘制
  // =====================================================================
  W2.draw = function () {
    var R = G.render2d;
    var m = W2.map;
    if (!R || !m) return;

    R.begin('#1A2418');

    // ---- 地面层 ----
    var T = W2.TILE;
    var camX = R.cam.x, camY = R.cam.y;
    var c0 = Math.max(0, Math.floor(camX / T));
    var c1 = Math.min(m.cols - 1, Math.ceil((camX + R.VIEW_W) / T));
    var r0 = Math.max(0, Math.floor(camY / T));
    var r1 = Math.min(m.rows - 1, Math.ceil((camY + R.VIEW_H) / T));

    var ctx = R.ctx;
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var name = m.ground[r * m.cols + c];
        if (!name) continue;
        var t = G.tiles16.get(name);
        if (!t) continue;
        ctx.drawImage(
          t.img, t.sx, t.sy, t.sw, t.sh,
          Math.round(c * T - camX), Math.round(r * T - camY),
          T, T
        );
      }
    }

    // ---- 装饰层（草丛/灌木，带透明，用画家算法排序）----
    for (var r2 = r0; r2 <= r1; r2++) {
      for (var c2 = c0; c2 <= c1; c2++) {
        var dn = m.deco[r2 * m.cols + c2];
        if (!dn) continue;
        var dt2 = G.tiles16.get(dn);
        if (!dt2) continue;
        ctx.drawImage(
          dt2.img, dt2.sx, dt2.sy, dt2.sw, dt2.sh,
          Math.round(c2 * T - camX), Math.round(r2 * T - camY),
          T, T
        );
      }
    }

    // ---- 角色层：按 y 排序 ----
    R.clearSprites();

    // NPC
    var npcFrames = [0, 0, 0, 0];
    W2.npcs.forEach(function (n) {
      var f = G.tiles16.charFrame(n.dir, 0);
      if (!f) return;
      R.pushSprite({
        img: f.img, sx: f.sx, sy: f.sy, sw: f.sw, sh: f.sh,
        wx: n.x, wy: n.y,
        dw: T, dh: T * 2,      // 32×64 → 显示成 32×64（即 1×2 格）
        sortY: n.y
      });
    });

    // 玩家
    var p = W2.player;
    var pf = G.tiles16.charFrame(p.dir, p.frame);
    if (pf) {
      R.pushSprite({
        img: pf.img, sx: pf.sx, sy: pf.sy, sw: pf.sw, sh: pf.sh,
        wx: p.x, wy: p.y,
        dw: T, dh: T * 2,
        sortY: p.y
      });
    }

    R.flushSprites();
    R.present();
  };

  // =====================================================================
  // 调试信息
  // =====================================================================
  W2.info = function () {
    if (!W2.map || !W2.player) return null;
    return {
      cols: W2.map.cols,
      rows: W2.map.rows,
      playerTile: [
        Math.floor(W2.player.x / W2.TILE),
        Math.floor(W2.player.y / W2.TILE)
      ],
      playerDir: W2.player.dir,
      playerFrame: W2.player.frame,
      npcCount: W2.npcs.length
    };
  };

})(window.G = window.G || {});
