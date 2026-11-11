/* 12-textures.js — 程序化材质贴图库
 *
 * 所有贴图都用 canvas 代码生成，零图片文件（这是单文件交付的硬约束）。
 * 分辨率统一 64x64：在 640x360 内部渲染下，一个小物件大概占 20~40 像素，
 * 64x64 的贴图足够，再大就是浪费。
 *
 * 每张贴图都自带"脏感"：随机噪点 + 边缘磨损 + 色斑，
 * 这是摆脱"纯色块简约感"最关键的一步。
 */
(function (G) {
  'use strict';

  var T = G.tex = {};

  /** 基础工具：造一个 64x64 canvas 并填底色 */
  function base(size, color) {
    var c = G.makeCanvas(size, size);
    var ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    return { c: c, ctx: ctx, size: size };
  }

  /** 撒噪点（用确定性 RNG，保证同种子同图） */
  function speckle(ctx, size, rnd, count, colors, scale) {
    scale = scale || 1;
    for (var i = 0; i < count; i++) {
      ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
      var x = Math.floor(rnd() * size);
      var y = Math.floor(rnd() * size);
      var w = rnd() > 0.85 ? 2 * scale : scale;
      var h = rnd() > 0.85 ? 2 * scale : scale;
      ctx.fillRect(x, y, w, h);
    }
  }

  /** 在边缘一圈加暗边（模拟磨损/积垢） */
  function edgeGrime(ctx, size, rnd, color, thickness) {
    thickness = thickness || 2;
    ctx.fillStyle = color;
    for (var i = 0; i < size; i++) {
      if (rnd() > 0.35) { ctx.fillRect(i, 0, 1, thickness); ctx.fillRect(i, size - thickness, 1, thickness); }
      if (rnd() > 0.35) { ctx.fillRect(0, i, thickness, 1); ctx.fillRect(size - thickness, i, thickness, 1); }
    }
  }

  // =====================================================================
  // 1) 木纹
  // =====================================================================
  T.wood = function (colorHex, opt) {
    opt = opt || {};
    var size = 64;
    var b = base(size, colorHex);
    var rnd = G.mulberry32(opt.seed || 11);

    // 顺纹的深浅条：竖向木纹
    for (var x = 0; x < size; x++) {
      var tone = 0.5 + Math.sin(x * 0.55 + rnd() * 0.4) * 0.22
                     + Math.sin(x * 1.7) * 0.08;
      if (rnd() > 0.72) tone -= 0.18;
      b.ctx.fillStyle = G.col.shade(colorHex, (tone - 0.5) * 0.5);
      b.ctx.globalAlpha = 0.55;
      b.ctx.fillRect(x, 0, 1, size);
    }
    b.ctx.globalAlpha = 1;

    // 横向木节
    var knots = 1 + Math.floor(rnd() * 2);
    for (var k = 0; k < knots; k++) {
      var kx = 8 + rnd() * (size - 16);
      var ky = 8 + rnd() * (size - 16);
      b.ctx.strokeStyle = G.col.shade(colorHex, -0.32);
      b.ctx.lineWidth = 1;
      for (var r = 2; r < 6; r += 1.6) {
        b.ctx.beginPath();
        b.ctx.ellipse(kx, ky, r * 0.7, r, 0, 0, Math.PI * 2);
        b.ctx.stroke();
      }
    }

    // 噪点 + 边缘
    speckle(b.ctx, size, rnd, 90, [
      G.col.shade(colorHex, -0.22),
      G.col.shade(colorHex, 0.14)
    ]);
    edgeGrime(b.ctx, size, rnd, G.col.shade(colorHex, -0.3), 1);

    return G.canvasTexture(b.c);
  };

  // =====================================================================
  // 2) 石砖（用于铺地、基座、台阶）
  // =====================================================================
  T.stoneBrick = function (colorHex, opt) {
    opt = opt || {};
    var size = 64;
    var b = base(size, colorHex);
    var rnd = G.mulberry32(opt.seed || 23);
    var brickH = 16, brickW = 32;

    // 砖缝
    b.ctx.fillStyle = G.col.shade(colorHex, -0.42);
    for (var row = 0; row < size / brickH; row++) {
      var y = row * brickH;
      b.ctx.fillRect(0, y, size, 1.5);
      // 竖缝错位
      var offset = (row % 2) * (brickW / 2);
      for (var col = -1; col < size / brickW + 1; col++) {
        var x = col * brickW + offset;
        b.ctx.fillRect(x, y, 1.5, brickH);
      }
    }

    // 每块砖的明暗差异
    for (var r2 = 0; r2 < size / brickH; r2++) {
      var y2 = r2 * brickH;
      var offset2 = (r2 % 2) * (brickW / 2);
      for (var c2 = -1; c2 < size / brickW + 1; c2++) {
        var x2 = c2 * brickW + offset2;
        var tone = (rnd() - 0.5) * 0.24;
        b.ctx.globalAlpha = 0.5;
        b.ctx.fillStyle = G.col.shade(colorHex, tone);
        b.ctx.fillRect(x2 + 2, y2 + 2, brickW - 3, brickH - 3);
      }
    }
    b.ctx.globalAlpha = 1;

    speckle(b.ctx, size, rnd, 120, [
      G.col.shade(colorHex, -0.18),
      G.col.shade(colorHex, 0.12)
    ]);
    edgeGrime(b.ctx, size, rnd, G.col.shade(colorHex, -0.34), 1);

    return G.canvasTexture(b.c);
  };

  // =====================================================================
  // 3) 瓦片屋顶（横向弧瓦）
  // =====================================================================
  T.roofTile = function (colorHex, opt) {
    opt = opt || {};
    var size = 64;
    var b = base(size, colorHex);
    var rnd = G.mulberry32(opt.seed || 37);
    var tileW = 8, tileH = 10;

    // 瓦垄（竖条纹）
    for (var x = 0; x < size; x += tileW) {
      // 每垄一个半圆高光
      var grad = b.ctx.createLinearGradient(x, 0, x + tileW, 0);
      grad.addColorStop(0, G.col.shade(colorHex, -0.3));
      grad.addColorStop(0.35, G.col.shade(colorHex, 0.18));
      grad.addColorStop(0.7, G.col.shade(colorHex, 0.02));
      grad.addColorStop(1, G.col.shade(colorHex, -0.36));
      b.ctx.fillStyle = grad;
      b.ctx.fillRect(x, 0, tileW, size);
    }

    // 横向瓦片错缝
    b.ctx.fillStyle = G.col.shade(colorHex, -0.42);
    for (var row = 0; row < size / tileH; row++) {
      var y = row * tileH;
      b.ctx.fillRect(0, y, size, 1.5);
    }

    speckle(b.ctx, size, rnd, 70, [
      G.col.shade(colorHex, -0.2),
      G.col.shade(colorHex, 0.14)
    ]);

    return G.canvasTexture(b.c);
  };

  // =====================================================================
  // 4) 和纸 / 墙面（细微颗粒 + 纤维）
  // =====================================================================
  T.washi = function (colorHex, opt) {
    opt = opt || {};
    var size = 64;
    var b = base(size, colorHex);
    var rnd = G.mulberry32(opt.seed || 53);

    // 纸纤维：细短的横竖线
    b.ctx.globalAlpha = 0.16;
    for (var i = 0; i < 70; i++) {
      var x = rnd() * size, y = rnd() * size;
      var horiz = rnd() > 0.5;
      var len = 3 + rnd() * 8;
      b.ctx.strokeStyle = rnd() > 0.5
        ? G.col.shade(colorHex, -0.2)
        : G.col.shade(colorHex, 0.16);
      b.ctx.beginPath();
      b.ctx.moveTo(x, y);
      b.ctx.lineTo(x + (horiz ? len : 0), y + (horiz ? 0 : len));
      b.ctx.stroke();
    }
    b.ctx.globalAlpha = 1;

    speckle(b.ctx, size, rnd, 140, [
      G.col.shade(colorHex, -0.1),
      G.col.shade(colorHex, 0.08)
    ]);

    return G.canvasTexture(b.c);
  };

  // =====================================================================
  // 5) 草地（比原版更密、有层次）
  // =====================================================================
  T.grass = function (colorHex, opt) {
    opt = opt || {};
    var size = 64;
    var b = base(size, colorHex);
    var rnd = G.mulberry32(opt.seed || 5);

    // 大块色斑（低频层次）
    for (var i = 0; i < 22; i++) {
      var cx = rnd() * size, cy = rnd() * size;
      var r = 6 + rnd() * 12;
      var grd = b.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      var tone = (rnd() - 0.5) * 0.3;
      grd.addColorStop(0, G.col.shade(colorHex, tone));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      b.ctx.fillStyle = grd;
      b.ctx.globalAlpha = 0.5;
      b.ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    b.ctx.globalAlpha = 1;

    // 草叶：短的竖向笔画，比噪点更有"草"的感觉
    for (var g2 = 0; g2 < 260; g2++) {
      var gx = Math.floor(rnd() * size);
      var gy = Math.floor(rnd() * size);
      var gh = 2 + Math.floor(rnd() * 2);
      b.ctx.fillStyle = rnd() > 0.5
        ? G.col.shade(colorHex, -0.26)
        : G.col.shade(colorHex, 0.16);
      b.ctx.fillRect(gx, gy, 1, gh);
    }

    // 少量小白花/黄花点缀
    for (var f = 0; f < 7; f++) {
      var fx = Math.floor(rnd() * size);
      var fy = Math.floor(rnd() * size);
      b.ctx.fillStyle = rnd() > 0.5 ? '#FBF3E4' : '#F2D98A';
      b.ctx.fillRect(fx, fy, 1, 1);
    }

    return G.canvasTexture(b.c);
  };

  // =====================================================================
  // 6) 土路（碎石 + 车辙）
  // =====================================================================
  T.dirt = function (colorHex, opt) {
    opt = opt || {};
    var size = 64;
    var b = base(size, colorHex);
    var rnd = G.mulberry32(opt.seed || 71);

    // 色斑
    for (var i = 0; i < 18; i++) {
      var cx = rnd() * size, cy = rnd() * size, r = 5 + rnd() * 10;
      var grd = b.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, G.col.shade(colorHex, (rnd() - 0.5) * 0.26));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      b.ctx.fillStyle = grd;
      b.ctx.globalAlpha = 0.55;
      b.ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    b.ctx.globalAlpha = 1;

    // 碎石
    for (var s = 0; s < 90; s++) {
      var sx = Math.floor(rnd() * size);
      var sy = Math.floor(rnd() * size);
      var sr = rnd() > 0.8 ? 2 : 1;
      b.ctx.fillStyle = rnd() > 0.5
        ? G.col.shade(colorHex, -0.34)
        : G.col.shade(colorHex, 0.2);
      b.ctx.fillRect(sx, sy, sr, sr);
    }

    return G.canvasTexture(b.c);
  };

  // =====================================================================
  // 7) 竹竿（横向分节 + 竖向纤维）
  // =====================================================================
  T.bambooSkin = function (colorHex, opt) {
    opt = opt || {};
    var size = 64;
    var b = base(size, colorHex);
    var rnd = G.mulberry32(opt.seed || 83);

    // 竖向纤维
    for (var x = 0; x < size; x += 2) {
      b.ctx.globalAlpha = 0.3;
      b.ctx.fillStyle = rnd() > 0.5
        ? G.col.shade(colorHex, 0.12)
        : G.col.shade(colorHex, -0.12);
      b.ctx.fillRect(x, 0, 1, size);
    }
    b.ctx.globalAlpha = 1;

    // 横向竹节
    b.ctx.fillStyle = G.col.shade(colorHex, -0.4);
    for (var n = 0; n < 3; n++) {
      var y = 10 + n * 20;
      b.ctx.fillRect(0, y, size, 2);
      b.ctx.fillStyle = G.col.shade(colorHex, 0.24);
      b.ctx.fillRect(0, y + 2, size, 1);
      b.ctx.fillStyle = G.col.shade(colorHex, -0.4);
    }

    speckle(b.ctx, size, rnd, 40, [G.col.shade(colorHex, -0.18)]);
    return G.canvasTexture(b.c);
  };

  // =====================================================================
  // 8) 树干（粗糙纵向裂纹）
  // =====================================================================
  T.bark = function (colorHex, opt) {
    opt = opt || {};
    var size = 64;
    var b = base(size, colorHex);
    var rnd = G.mulberry32(opt.seed || 97);

    // 纵向裂纹
    for (var i = 0; i < 16; i++) {
      var x = rnd() * size;
      b.ctx.strokeStyle = G.col.shade(colorHex, -0.36);
      b.ctx.lineWidth = rnd() > 0.7 ? 2 : 1;
      b.ctx.beginPath();
      b.ctx.moveTo(x, 0);
      var cy = 0;
      while (cy < size) {
        cy += 6 + rnd() * 10;
        x += (rnd() - 0.5) * 3;
        b.ctx.lineTo(x, cy);
      }
      b.ctx.stroke();
    }

    // 高光棱
    for (var j = 0; j < 10; j++) {
      b.ctx.globalAlpha = 0.25;
      b.ctx.fillStyle = G.col.shade(colorHex, 0.2);
      b.ctx.fillRect(rnd() * size, 0, 1, size);
    }
    b.ctx.globalAlpha = 1;

    speckle(b.ctx, size, rnd, 80, [
      G.col.shade(colorHex, -0.24),
      G.col.shade(colorHex, 0.14)
    ]);

    return G.canvasTexture(b.c);
  };

  // =====================================================================
  // 9) 樱花花瓣簇（给花冠用，带花瓣层次）
  // =====================================================================
  T.blossom = function (colorHex, opt) {
    opt = opt || {};
    var size = 64;
    var b = base(size, colorHex);
    var rnd = G.mulberry32(opt.seed || 131);

    // 一堆大小不一的圆点 = 花瓣团
    for (var i = 0; i < 60; i++) {
      var cx = rnd() * size, cy = rnd() * size;
      var r = 2 + rnd() * 5;
      var tone = (rnd() - 0.5) * 0.34;
      b.ctx.fillStyle = G.col.shade(colorHex, tone);
      b.ctx.globalAlpha = 0.85;
      b.ctx.beginPath();
      b.ctx.arc(cx, cy, r, 0, Math.PI * 2);
      b.ctx.fill();
    }
    b.ctx.globalAlpha = 1;

    // 深色花瓣间隙
    for (var j = 0; j < 24; j++) {
      b.ctx.fillStyle = G.col.shade(colorHex, -0.28);
      b.ctx.globalAlpha = 0.5;
      b.ctx.beginPath();
      b.ctx.arc(rnd() * size, rnd() * size, 1 + rnd() * 2, 0, Math.PI * 2);
      b.ctx.fill();
    }
    b.ctx.globalAlpha = 1;

    return G.canvasTexture(b.c);
  };

  // =====================================================================
  // 通用缓存：同参数只生成一次
  // =====================================================================
  var cache = {};
  G.texCached = function (kind, colorHex, opt) {
    var key = kind + '|' + colorHex + '|' + JSON.stringify(opt || {});
    if (!cache[key]) {
      var fn = T[kind];
      if (!fn) { console.warn('[tex] unknown kind', kind); return null; }
      cache[key] = fn(colorHex, opt);
      cache[key].wrapS = THREE.RepeatWrapping;
      cache[key].wrapT = THREE.RepeatWrapping;
    }
    return cache[key];
  };

})(window.G = window.G || {});
