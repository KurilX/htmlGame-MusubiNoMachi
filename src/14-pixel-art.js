/* 14-pixel-art.js — 俯视像素贴图（程序化）
 *
 * 【设计约束】
 *  - 零图片文件：所有贴图用 canvas 画出来
 *  - NearestFilter 放大：保持硬边像素感，不做平滑
 *  - 低分辨率：地块 16×16、角色 16×24，靠整数倍放大出像素颗粒
 *
 * 【为什么全部重画】
 * 正俯视下，原先为斜视角做的 3D 几何体全部失效：
 *   房子只剩屋顶、鸟居变成一根横杆、玩家（竖直 billboard）直接消失。
 * 所以俯视风格必须用"俯视专用贴图"重新表达每个物件。
 *
 * 【配色】沿用原来的和风配色（朱红、米白、樱粉、苔绿），
 * 只换表现方式，不换世界的气质。
 */
(function (G) {
  'use strict';

  var PA = G.pixelArt = {};

  // ---------- canvas 工具 ----------
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return { c: c, g: g };
  }

  function toTexture(canvas) {
    var t = new THREE.CanvasTexture(canvas);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // 确定性随机（同一 seed 每次画出来一样）
  function rng(seed) {
    var s = seed | 0;
    return function () {
      s = (s * 1664525 + 1013904223) | 0;
      return ((s >>> 8) & 0xFFFFFF) / 0xFFFFFF;
    };
  }

  var cache = {};
  function cached(key, fn) {
    if (!cache[key]) cache[key] = fn();
    return cache[key];
  }

  // =====================================================================
  // 地面瓦片（16×16）
  // =====================================================================

  /**
   * 草地瓦片。
   * 要点：不能是纯色 —— 纯色放大后就是一块死板的大色块。
   * 用 3 层深浅点阵制造"草"的颗粒感。
   */
  PA.grassTile = function (variant) {
    return cached('grass' + (variant || 0), function () {
      var m = makeCanvas(16, 16);
      var g = m.g, r = rng(1000 + (variant || 0) * 37);

      // 底色
      g.fillStyle = '#7FA05A';
      g.fillRect(0, 0, 16, 16);

      // 深色草簇
      for (var i = 0; i < 26; i++) {
        var x = Math.floor(r() * 16), y = Math.floor(r() * 16);
        g.fillStyle = r() > 0.5 ? '#6E8F4C' : '#8CB066';
        g.fillRect(x, y, 1, 1);
      }

      // 少量亮色草尖（竖 2px，像草叶）
      for (var j = 0; j < 5; j++) {
        var x2 = Math.floor(r() * 16), y2 = Math.floor(r() * 14) + 1;
        g.fillStyle = '#9CC274';
        g.fillRect(x2, y2, 1, 2);
      }

      return m.c;
    });
  };

  /** 土路瓦片 */
  PA.dirtTile = function (variant) {
    return cached('dirt' + (variant || 0), function () {
      var m = makeCanvas(16, 16);
      var g = m.g, r = rng(2000 + (variant || 0) * 53);

      g.fillStyle = '#C4A878';
      g.fillRect(0, 0, 16, 16);

      for (var i = 0; i < 30; i++) {
        var x = Math.floor(r() * 16), y = Math.floor(r() * 16);
        var v = r();
        g.fillStyle = v > 0.66 ? '#B09566' : (v > 0.33 ? '#D2B98C' : '#A88C5E');
        g.fillRect(x, y, 1, 1);
      }
      // 几粒小石子
      for (var j = 0; j < 3; j++) {
        var sx = Math.floor(r() * 15), sy = Math.floor(r() * 15);
        g.fillStyle = '#8E7B55';
        g.fillRect(sx, sy, 2, 2);
      }
      return m.c;
    });
  };

  /** 石板瓦片（城镇地面） */
  PA.stoneTile = function () {
    return cached('stone', function () {
      var m = makeCanvas(16, 16);
      var g = m.g, r = rng(3000);

      g.fillStyle = '#B8B0A0';
      g.fillRect(0, 0, 16, 16);

      // 石板缝：横竖各一条
      g.fillStyle = '#9A9284';
      g.fillRect(0, 7, 16, 1);
      g.fillRect(7, 0, 1, 16);

      for (var i = 0; i < 18; i++) {
        var x = Math.floor(r() * 16), y = Math.floor(r() * 16);
        g.fillStyle = r() > 0.5 ? '#A89E8C' : '#C6BEB0';
        g.fillRect(x, y, 1, 1);
      }
      return m.c;
    });
  };

  // =====================================================================
  // 角色行走图（4 方向 × 4 帧）
  // =====================================================================
  //
  // 单帧 16×24，图集 64×96。
  // 帧序：0=站立 1=迈左脚 2=站立 3=迈右脚（经典 RPG Maker 循环）
  // 方向序：0=下（面向镜头）1=左 2=右 3=上
  //
  // 【为什么 4 方向而不是 8】俯视像素风格传统就是 4 方向；
  // 8 方向在小尺寸下反而看不清差异。

  PA.FRAME_W = 16;
  PA.FRAME_H = 24;
  PA.DIRS = 4;
  PA.FRAMES = 4;

  /**
   * 画一个角色行走图集。
   * @param {object} look  { kimono, kimonoSh, hair, hairSh, obi, skin }
   */
  PA.characterSheet = function (look) {
    var key = 'char|' + [look.kimono, look.kimonoSh, look.hair, look.hairSh,
      look.obi, look.skin].join(',');
    return cached(key, function () {
      var W = PA.FRAME_W, H = PA.FRAME_H;
      var m = makeCanvas(W * PA.FRAMES, H * PA.DIRS);
      var g = m.g;

      var skin = look.skin || '#FCE0CE';
      var hair = look.hair || '#4A3025';
      var hairSh = look.hairSh || '#2E1E16';
      var robe = look.kimono || '#F7C8D8';
      var robeSh = look.kimonoSh || '#D9A0B8';
      var obi = look.obi || '#7FB069';

      // 腿的偏移：帧 0/2 站立，1 迈左，3 迈右
      var legShift = [0, -1, 0, 1];

      for (var d = 0; d < PA.DIRS; d++) {
        for (var f = 0; f < PA.FRAMES; f++) {
          var ox = f * W, oy = d * H;
          var ls = legShift[f];

          // ---- 腿（先画，被衣服盖住上半）----
          g.fillStyle = '#E8DCC8';
          if (d === 0 || d === 3) {
            // 正面/背面：两条腿，交替前后
            g.fillRect(ox + 5, oy + 18 + (ls < 0 ? -1 : 0), 2, 4);
            g.fillRect(ox + 9, oy + 18 + (ls > 0 ? -1 : 0), 2, 4);
          } else {
            // 侧面：一条腿在前
            g.fillRect(ox + 7, oy + 18 + (ls > 0 ? -1 : 0), 2, 4);
            g.fillRect(ox + 6, oy + 18 + (ls < 0 ? -1 : 0), 2, 3);
          }
          // 鞋
          g.fillStyle = '#5A4A3A';
          if (d === 0 || d === 3) {
            g.fillRect(ox + 5, oy + 22 + (ls < 0 ? -1 : 0), 2, 1);
            g.fillRect(ox + 9, oy + 22 + (ls > 0 ? -1 : 0), 2, 1);
          } else {
            g.fillRect(ox + 6, oy + 22 + (ls > 0 ? -1 : 0), 3, 1);
          }

          // ---- 身体（和服）----
          g.fillStyle = robe;
          g.fillRect(ox + 4, oy + 12, 8, 7);
          // 侧身时窄一点
          if (d === 1 || d === 2) {
            g.clearRect(ox + 4, oy + 12, 1, 7);
            g.clearRect(ox + 11, oy + 12, 1, 7);
          }
          // 衣服暗部（左侧）
          g.fillStyle = robeSh;
          g.fillRect(ox + 4, oy + 12, 2, 7);
          if (d === 1 || d === 2) {
            g.fillRect(ox + 5, oy + 12, 1, 7);
          }

          // 腰带
          g.fillStyle = obi;
          g.fillRect(ox + 4, oy + 16, 8, 2);
          if (d === 1 || d === 2) g.fillRect(ox + 5, oy + 16, 6, 2);

          // ---- 头 ----
          g.fillStyle = skin;
          g.fillRect(ox + 5, oy + 5, 6, 6);

          // 头发：按方向不同
          g.fillStyle = hair;
          if (d === 3) {
            // 背面：整个后脑勺都是头发
            g.fillRect(ox + 4, oy + 3, 8, 7);
            g.fillStyle = hairSh;
            g.fillRect(ox + 4, oy + 8, 8, 2);
          } else if (d === 0) {
            // 正面：刘海 + 两侧
            g.fillRect(ox + 4, oy + 3, 8, 4);
            g.fillRect(ox + 4, oy + 3, 1, 5);
            g.fillRect(ox + 11, oy + 3, 1, 5);
          } else {
            // 侧面
            g.fillRect(ox + 4, oy + 3, 8, 4);
            if (d === 1) {
              // 朝左：头发偏左
              g.fillRect(ox + 3, oy + 3, 2, 6);
            } else {
              g.fillRect(ox + 11, oy + 3, 2, 6);
            }
          }

          // ---- 眼睛（正面/侧面才有）----
          if (d === 0) {
            g.fillStyle = '#2E2320';
            g.fillRect(ox + 6, oy + 8, 1, 1);
            g.fillRect(ox + 9, oy + 8, 1, 1);
          } else if (d === 1) {
            g.fillStyle = '#2E2320';
            g.fillRect(ox + 6, oy + 8, 1, 1);
          } else if (d === 2) {
            g.fillStyle = '#2E2320';
            g.fillRect(ox + 9, oy + 8, 1, 1);
          }
        }
      }

      return m.c;
    });
  };

  // =====================================================================
  // 俯视物件
  // =====================================================================

  /**
   * 房子（俯视）。
   *
   * 【要点】正俯视下只能看到屋顶，但完全只画屋顶会"认不出是房子"。
   * 传统俯视像素游戏的做法：屋顶 + 底部露一条前墙（带门），
   * 用这条墙表达"这是一栋立着的建筑"。
   */
  PA.houseTopDown = function (wTiles, dTiles, opt) {
    opt = opt || {};
    var roofColor = opt.roof || '#B0392E';
    var roofDark = opt.roofDark || '#8A2A22';
    var wallColor = opt.wall || '#E8DCC8';
    var key = 'house|' + wTiles + 'x' + dTiles + '|' + roofColor + '|' + (opt.noren || '');

    return cached(key, function () {
      var W = wTiles * 16, H = dTiles * 16 + 8;   // 额外 8px 给前墙
      var m = makeCanvas(W, H);
      var g = m.g;
      var r = rng(4000 + wTiles * 31 + dTiles * 17);

      // ---- 屋顶（瓦片）----
      g.fillStyle = roofColor;
      g.fillRect(0, 0, W, dTiles * 16);

      // 瓦片横纹
      for (var y = 0; y < dTiles * 16; y += 4) {
        g.fillStyle = roofDark;
        g.fillRect(0, y, W, 1);
        // 竖缝错位
        var off = (y % 8 === 0) ? 0 : 4;
        for (var x = off; x < W; x += 8) {
          g.fillRect(x, y, 1, 4);
        }
      }

      // 屋脊高光（顶部一条亮线）
      g.fillStyle = opt.roofHi || '#D4655A';
      g.fillRect(0, 0, W, 2);

      // 屋顶边缘描边
      g.fillStyle = roofDark;
      g.fillRect(0, 0, W, 1);
      g.fillRect(0, dTiles * 16 - 1, W, 1);
      g.fillRect(0, 0, 1, dTiles * 16);
      g.fillRect(W - 1, 0, 1, dTiles * 16);

      // ---- 前墙（露在屋顶下方）----
      var wy = dTiles * 16;
      g.fillStyle = wallColor;
      g.fillRect(0, wy, W, 8);
      g.fillStyle = '#C8BCA8';
      g.fillRect(0, wy + 7, W, 1);

      // 门
      var doorW = 10, doorX = Math.floor((W - doorW) / 2);
      g.fillStyle = '#6B4A32';
      g.fillRect(doorX, wy + 1, doorW, 7);

      // 暖帘
      if (opt.noren) {
        g.fillStyle = opt.noren;
        g.fillRect(doorX, wy + 1, doorW, 3);
      }

      return m.c;
    });
  };

  /**
   * 树（俯视）。
   * 树冠从正上方看是一个圆形色块 + 明暗层次，
   * 关键是**不能画成一个纯色圆**，要有叶簇的起伏。
   */
  PA.treeTopDown = function (seed, opt) {
    opt = opt || {};
    var canopy = opt.canopy || '#F0B8C8';     // 樱粉
    var canopyHi = opt.canopyHi || '#FCD8E4';
    var canopyLo = opt.canopyLo || '#D898AC';
    var key = 'tree|' + seed + '|' + canopy;

    return cached(key, function () {
      var S = 28;
      var m = makeCanvas(S, S);
      var g = m.g;
      var r = rng(5000 + seed * 97);
      var c = S / 2;

      // 树冠：多个重叠圆，制造叶簇起伏
      for (var i = 0; i < 7; i++) {
        var a = r() * Math.PI * 2;
        var rad = r() * (c - 5);
        var px = c + Math.cos(a) * rad;
        var py = c + Math.sin(a) * rad;
        var rr = 4 + r() * 4;
        g.fillStyle = i % 3 === 0 ? canopyHi : (i % 3 === 1 ? canopy : canopyLo);
        g.beginPath();
        g.arc(px, py, rr, 0, Math.PI * 2);
        g.fill();
      }

      // 中心亮部（受光）
      g.fillStyle = canopyHi;
      g.beginPath();
      g.arc(c - 2, c - 2, 5, 0, Math.PI * 2);
      g.fill();

      // 外轮廓（硬边，像素风关键）
      g.strokeStyle = canopyLo;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(c, c, c - 2, 0, Math.PI * 2);
      g.stroke();

      return m.c;
    });
  };

  /** 鸟居（俯视）：两根柱子 + 一根横梁，从上面看是"H"形 */
  PA.toriiTopDown = function () {
    return cached('toriiTop', function () {
      var W = 28, H = 14;
      var m = makeCanvas(W, H);
      var g = m.g;
      var red = '#C0392B', redDark = '#8E2820';

      // 横梁（上方）
      g.fillStyle = red;
      g.fillRect(0, 2, W, 4);
      g.fillStyle = redDark;
      g.fillRect(0, 5, W, 1);

      // 两根柱子（纵向延伸，带阴影感）
      g.fillStyle = red;
      g.fillRect(3, 6, 3, 8);
      g.fillRect(W - 6, 6, 3, 8);
      g.fillStyle = redDark;
      g.fillRect(3, 6, 1, 8);
      g.fillRect(W - 6, 6, 1, 8);

      return m.c;
    });
  };

  /** 石灯笼（俯视）：一个小方块 + 顶部亮面 */
  PA.lanternTopDown = function () {
    return cached('lanternTop', function () {
      var S = 10;
      var m = makeCanvas(S, S);
      var g = m.g;
      g.fillStyle = '#8E8878';
      g.fillRect(1, 1, 8, 8);
      g.fillStyle = '#B8B2A0';
      g.fillRect(2, 2, 6, 6);
      g.fillStyle = '#F5E8B8';      // 灯芯
      g.fillRect(4, 4, 2, 2);
      return m.c;
    });
  };

  /** 敌人（俯视）：小鬼 —— 圆身 + 两只角 */
  PA.enemyTopDown = function (kind) {
    var key = 'enemy|' + kind;
    return cached(key, function () {
      var W = 16, H = 16;
      var m = makeCanvas(W, H);
      var g = m.g;

      var body, bodyHi, eye;
      if (kind === 'yurei') { body = '#A8C8E0'; bodyHi = '#D8E8F4'; eye = '#2E2320'; }
      else if (kind === 'kappa') { body = '#7FB069'; bodyHi = '#A8D494'; eye = '#2E2320'; }
      else if (kind === 'tengu') { body = '#C0392B'; bodyHi = '#E05A4F'; eye = '#FFF'; }
      else { body = '#E8A050'; bodyHi = '#F8C878'; eye = '#2E2320'; }   // onibi 等

      // 身体（圆）
      g.fillStyle = body;
      g.beginPath();
      g.arc(8, 9, 5.5, 0, Math.PI * 2);
      g.fill();

      // 高光
      g.fillStyle = bodyHi;
      g.beginPath();
      g.arc(6, 7, 2.5, 0, Math.PI * 2);
      g.fill();

      // 轮廓
      g.strokeStyle = '#2E2320';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(8, 9, 5.5, 0, Math.PI * 2);
      g.stroke();

      // 眼睛
      g.fillStyle = eye;
      g.fillRect(6, 8, 1, 2);
      g.fillRect(10, 8, 1, 2);

      // 角（非幽霊）
      if (kind !== 'yurei') {
        g.fillStyle = '#F5E8B8';
        g.fillRect(4, 2, 1, 2);
        g.fillRect(11, 2, 1, 2);
      }

      return m.c;
    });
  };

  // ---------- 转成 THREE 贴图 ----------
  PA.tex = function (canvas) {
    return cached('tex|' + (canvas.__id || (canvas.__id = Math.random().toString(36).slice(2))), function () {
      return toTexture(canvas);
    });
  };

  /** 直接给出 THREE 可用的贴图（内部处理缓存） */
  PA.grassTexture = function (v) { return PA.tex(PA.grassTile(v || 0)); };
  PA.dirtTexture = function (v) { return PA.tex(PA.dirtTile(v || 0)); };
  PA.stoneTexture = function () { return PA.tex(PA.stoneTile()); };
  PA.charTexture = function (look) { return PA.tex(PA.characterSheet(look)); };
  PA.houseTexture = function (w, d, opt) { return PA.tex(PA.houseTopDown(w, d, opt)); };
  PA.treeTexture = function (seed, opt) { return PA.tex(PA.treeTopDown(seed, opt)); };
  PA.toriiTexture = function () { return PA.tex(PA.toriiTopDown()); };
  PA.lanternTexture = function () { return PA.tex(PA.lanternTopDown()); };
  PA.enemyTexture = function (kind) { return PA.tex(PA.enemyTopDown(kind)); };

})(window.G = window.G || {});
