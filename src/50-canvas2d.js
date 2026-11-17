/* 50-canvas2d.js — 真正的 Canvas 2D 渲染层
 *
 * 【为什么彻底换掉 WebGL】
 * 前三次失败（图层穿透 / 角色消失 / 纹理混乱）都源于同一个原因：
 * 拿 3D 相机和 3D 几何去"模拟"2D 俯视。2D 游戏不需要深度缓冲，
 * 不需要正交相机，也不需要 billboard。
 *
 * 本文件提供：
 *   - 一个 Canvas 2D 上下文（带像素化缩放）
 *   - 相机（就是一个 x/y 偏移，没有旋转）
 *   - 按 y 排序的精灵绘制（画家算法，天然不会穿透）
 *   - 瓦片地图绘制
 *
 * 【坐标系】
 *   世界单位 = 像素（1:1），不做任何投影变换。
 *   地图用「格子」表示，一格 = TILE 像素（默认 32）。
 */
(function (G) {
  'use strict';

  var R = G.render2d = {};

  R.TILE = 32;             // 一格多少像素

  R.canvas = null;
  R.ctx = null;
  R.outCanvas = null;      // 屏幕上的 canvas
  R.outCtx = null;

  // 相机：世界坐标（像素）
  R.cam = { x: 0, y: 0 };
  R.camTarget = { x: 0, y: 0 };

  // 内部渲染尺寸（先按逻辑像素画，再整数倍放大）
  R.VIEW_W = 640;
  R.VIEW_H = 360;

  // 缩放倍率（自动按窗口算）
  R.scale = 1;

  // 绘制队列（按 y 排序）
  R._sprites = [];

  // =====================================================================
  // 初始化
  // =====================================================================
  R.init = function (outCanvas) {
    R.outCanvas = outCanvas || document.getElementById('gl');
    if (!R.outCanvas) { console.error('[render2d] 没有 canvas'); return false; }

    // 屏幕画布：关闭平滑，保持像素硬边
    R.outCtx = R.outCanvas.getContext('2d', { alpha: false });
    R.outCtx.imageSmoothingEnabled = false;

    // 离屏画布：按内部逻辑分辨率渲染
    R.canvas = document.createElement('canvas');
    R.canvas.width = R.VIEW_W;
    R.canvas.height = R.VIEW_H;
    R.ctx = R.canvas.getContext('2d', { alpha: false });
    R.ctx.imageSmoothingEnabled = false;

    R.resize();
    return true;
  };

  R.resize = function () {
    if (!R.outCanvas) return;
    var dpr = 1;
    var w = window.innerWidth, h = window.innerHeight;

    // 【关键：内部逻辑分辨率跟随窗口，保证铺满】
    //
    // 第一版把 VIEW 固定成 640×360，然后靠整数倍缩放铺到屏幕。
    // 问题：屏幕 1078×596 时 floor(min(1.68,1.65)) = 1，
    // 画面只有 640×360 占中间一小块，四周全是黑边。
    //
    // 像素风要的是「像素颗粒感」，不是「固定逻辑分辨率」。
    // 正确做法：逻辑分辨率按窗口算出一个"整数倍"关系，
    // 即 screen = logical × scale，且 scale 为整数，logical 尽量大。
    var targetScale = 2;                     // 目标放大倍率
    var lw = Math.floor(w / targetScale);
    var lh = Math.floor(h / targetScale);

    // 逻辑分辨率限制在合理范围（太小看不清，太大失去像素感）
    lw = Math.max(320, Math.min(960, lw));
    lh = Math.max(180, Math.min(540, lh));

    R.VIEW_W = lw;
    R.VIEW_H = lh;

    R.outCanvas.width = Math.floor(w * dpr);
    R.outCanvas.height = Math.floor(h * dpr);
    R.outCanvas.style.width = w + 'px';
    R.outCanvas.style.height = h + 'px';

    // 【复用已有的离屏 canvas】
    //
    // 踩过的坑：这里曾经写成「如果 R.canvas 不存在就新建」，
    // 但 init() 里已经建过一次，resize() 里又判断 `!R.canvas` ——
    // 而 init 之后 R.canvas 是存在的，所以不该重建。
    // 但如果反过来（resize 先执行、init 后执行），就会出问题。
    // 所以改成：**谁都可以保证 canvas 与 ctx 同时存在**。
    if (!R.canvas) {
      R.canvas = document.createElement('canvas');
    }
    if (!R.ctx) {
      R.ctx = R.canvas.getContext('2d', { alpha: false });
    }
    R.canvas.width = lw;
    R.canvas.height = lh;
    R.ctx.imageSmoothingEnabled = false;

    // 铺满屏幕（非整数倍也可以，但保持像素硬边）
    R.scale = Math.max(1, R.outCanvas.width / lw);
    R._dw = R.outCanvas.width;
    R._dh = R.outCanvas.height;
    R._dx = 0;
    R._dy = 0;

    R.outCtx.imageSmoothingEnabled = false;
    R.outCtx.fillStyle = '#0A0810';
    R.outCtx.fillRect(0, 0, R.outCanvas.width, R.outCanvas.height);
  };

  // =====================================================================
  // 相机
  // =====================================================================
  R.camFollow = function (worldX, worldY, snap) {
    R.camTarget.x = worldX - R.VIEW_W / 2;
    R.camTarget.y = worldY - R.VIEW_H / 2;
    if (snap) {
      R.cam.x = R.camTarget.x;
      R.cam.y = R.camTarget.y;
    }
  };

  R.camUpdate = function (dt) {
    // 平滑跟随（0.12 秒收敛）
    var k = Math.min(1, dt * 8);
    R.cam.x += (R.camTarget.x - R.cam.x) * k;
    R.cam.y += (R.camTarget.y - R.cam.y) * k;
  };

  /** 世界坐标 → 画布坐标 */
  R.w2c = function (wx, wy) {
    return { x: wx - R.cam.x, y: wy - R.cam.y };
  };

  // =====================================================================
  // 每帧开始：清屏
  // =====================================================================
  R.begin = function (bg) {
    var c = R.ctx;
    c.fillStyle = bg || '#1E2A1A';
    c.fillRect(0, 0, R.VIEW_W, R.VIEW_H);
  };

  // =====================================================================
  // 瓦片地图绘制
  // =====================================================================
  /**
   * 绘制瓦片地图。
   * @param {object} map   { cols, rows, tile, layers: [{ data: Int16Array|Array, tileset }] }
   *
   * layer.data 是一维数组，索引 = row * cols + col，值 = 瓦片编号（0 = 空）。
   * tileset 提供 getTile(id) -> { img, sx, sy, sw, sh }
   */
  R.drawMap = function (map) {
    var c = R.ctx;
    var T = map.tile || R.TILE;
    var camX = R.cam.x, camY = R.cam.y;

    // 只画可见范围（性能关键）
    var c0 = Math.max(0, Math.floor(camX / T));
    var c1 = Math.min(map.cols - 1, Math.ceil((camX + R.VIEW_W) / T));
    var r0 = Math.max(0, Math.floor(camY / T));
    var r1 = Math.min(map.rows - 1, Math.ceil((camY + R.VIEW_H) / T));

    for (var li = 0; li < map.layers.length; li++) {
      var layer = map.layers[li];
      var data = layer.data;
      var ts = layer.tileset;

      for (var r = r0; r <= r1; r++) {
        for (var cc = c0; cc <= c1; cc++) {
          var id = data[r * map.cols + cc];
          if (!id) continue;
          var t = ts.getTile(id);
          if (!t || !t.img) continue;

          // 【关键】drawImage 按像素矩形裁切 —— 所见即所得，
          // 不存在 UV 采样跨帧导致的"纹理混乱"
          c.drawImage(
            t.img,
            t.sx, t.sy, t.sw, t.sh,
            Math.round(cc * T - camX), Math.round(r * T - camY),
            T, T
          );
        }
      }
    }
  };

  // =====================================================================
  // 精灵（按 y 排序）
  // =====================================================================
  R.clearSprites = function () {
    R._sprites.length = 0;
  };

  /**
   * 加一个精灵到绘制队列。
   * @param {object} s { img, sx, sy, sw, sh, wx, wy, dw, dh, sortY, flip }
   *
   * wx/wy = 精灵「脚底」的世界坐标（排序锚点）
   */
  R.pushSprite = function (s) {
    R._sprites.push(s);
  };

  /** 把队列按 sortY 排序后绘制（画家算法） */
  R.flushSprites = function () {
    var list = R._sprites;
    list.sort(function (a, b) { return a.sortY - b.sortY; });

    var c = R.ctx;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s.img) continue;

      var dx = Math.round(s.wx - R.cam.x - (s.dw || s.sw) / 2);
      var dy = Math.round(s.wy - R.cam.y - (s.dh || s.sh));

      // 视口裁剪
      if (dx > R.VIEW_W || dy > R.VIEW_H ||
          dx + (s.dw || s.sw) < 0 || dy + (s.dh || s.sh) < 0) continue;

      var dw = s.dw || s.sw;
      var dh = s.dh || s.sh;

      if (s.flip) {
        c.save();
        c.translate(dx + dw, dy);
        c.scale(-1, 1);
        c.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, 0, 0, dw, dh);
        c.restore();
      } else {
        c.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, dx, dy, dw, dh);
      }
    }
    list.length = 0;
  };

  /** 直接画一个图片（不参与排序，用于 UI 层） */
  R.drawSpriteDirect = function (img, sx, sy, sw, sh, wx, wy, dw, dh) {
    var c = R.ctx;
    c.drawImage(img, sx, sy, sw, sh,
      Math.round(wx - R.cam.x), Math.round(wy - R.cam.y),
      dw || sw, dh || sh);
  };

  // =====================================================================
  // 屏幕合成
  // =====================================================================
  R.present = function () {
    var oc = R.outCtx;
    oc.imageSmoothingEnabled = false;
    oc.fillStyle = '#0A0810';
    oc.fillRect(0, 0, R.outCanvas.width, R.outCanvas.height);
    oc.drawImage(
      R.canvas,
      0, 0, R.VIEW_W, R.VIEW_H,
      R._dx, R._dy, R._dw, R._dh
    );
  };

  // =====================================================================
  // 调试信息
  // =====================================================================
  R.info = function () {
    return {
      viewW: R.VIEW_W, viewH: R.VIEW_H,
      scale: R.scale,
      camX: Math.round(R.cam.x), camY: Math.round(R.cam.y),
      canvasW: R.outCanvas ? R.outCanvas.width : 0
    };
  };

})(window.G = window.G || {});
