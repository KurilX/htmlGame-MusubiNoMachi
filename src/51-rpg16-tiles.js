/* 51-rpg16-tiles.js — RPG16 瓦片索引（唯一素材来源）
 *
 * 【为什么换成这套】
 * 之前反复失败是因为素材不配套：
 *   LPC terrain  → 只有自然地形，没有建筑
 *   exterior_32  → 斜俯视建筑，与 2D 正俯视不匹配
 *   minishcap    → 是对话框边框
 *
 * 这套（OpenGameArt "16x16 RPG Tileset", CC-BY-SA 3.0 + GPL）是**完整配套**：
 * 地形 / 泥土 / 沙滩 / 水 / 建筑 / 屋顶 / 植物 / 地板 / 角色，全部 16px 正俯视。
 *
 * 【坐标是怎么确定的】
 * 不是猜的。tools/find-tiles.js 用严格判据逐格扫描：
 *   1) 100% 不透明（否则平铺出黑洞）
 *   2) 颜色方差 < 900（否则平铺出重复图案）
 *   3) 不是纯黑/纯白（遮罩或空白）
 * 然后 tools/pick-verify.js 把候选裁出来拼成对照图人工确认。
 *
 * 每一块都经过这两步，见 tools/picks_check.png。
 */
(function (G) {
  'use strict';

  var T = G.tiles16 = {};

  T.SIZE = 16;              // 瓦片像素尺寸
  T.CHAR_W = 32;            // 角色帧宽
  T.CHAR_H = 64;            // 角色帧高
  T.CHAR_FRAMES = 7;        // 每方向 7 帧（0=站立，1~6 行走）
  T.CHAR_DIRS = 4;          // 0=下 1=上 2=左 3=右

  T.sheets = {};
  T.ok = false;

  /** 图集文件 */
  T.SHEETS = {
    terrain:     'assets/rpg16/1_terrain.png',
    indoors:     'assets/rpg16/2_indoors.png',
    plants:      'assets/rpg16/3_plants.png',
    buildings:   'assets/rpg16/4_buildings.png',
    waterfall:   'assets/rpg16/5_waterfall.png',
    floors:      'assets/rpg16/6_floors.png',
    grass_cliff: 'assets/rpg16/7_grass_cliff.png',
    cave:        'assets/rpg16/8_cave.png',
    beach:       'assets/rpg16/9_beach.png',
    dirt:        'assets/rpg16/10_dirt.png',
    roofs:       'assets/rpg16/11_roofs.png',
    chars:       'assets/rpg16/14_human_sprite_base.png'
  };

  /**
   * 瓦片定义。
   * 全部经 find-tiles.js 严格筛选 + pick-verify.js 人工确认。
   */
  T.DEFS = {
    // ============ 地形（1_terrain.png）============
    // 实测：绿色低方差块在 row 0，col 6~9
    'grass':   { sheet: 'terrain', r: 0, c: 6 },
    'grass2':  { sheet: 'terrain', r: 0, c: 7 },
    'grass3':  { sheet: 'terrain', r: 0, c: 8 },
    'grass4':  { sheet: 'terrain', r: 0, c: 9 },

    // 灰石（row 24）
    'stone':   { sheet: 'terrain', r: 24, c: 6 },
    'stone2':  { sheet: 'terrain', r: 24, c: 7 },

    // 红砖（row 0, col 26）
    'brick':   { sheet: 'terrain', r: 0, c: 26 },

    // ============ 泥土（10_dirt.png）============
    'dirt':    { sheet: 'dirt', r: 0, c: 6 },
    'dirt2':   { sheet: 'dirt', r: 1, c: 3 },

    // ============ 沙滩（9_beach.png）============
    'sand':    { sheet: 'beach', r: 8, c: 2 },

    // ============ 水（5_waterfall.png）============
    'water':   { sheet: 'waterfall', r: 8, c: 2 },
    'water2':  { sheet: 'waterfall', r: 8, c: 3 },

    // ============ 草地悬崖（7_grass_cliff.png）============
    'cliffGrass': { sheet: 'grass_cliff', r: 0, c: 23 },

    // ============ 地板（6_floors.png）============
    'floorWood':  { sheet: 'floors', r: 1, c: 1 },
    'floorWood2': { sheet: 'floors', r: 1, c: 2 },
    'floorStone': { sheet: 'floors', r: 6, c: 12 },
    'floorStone2':{ sheet: 'floors', r: 6, c: 13 },

    // ============ 屋顶（11_roofs.png）============
    'roof':    { sheet: 'roofs', r: 0, c: 8 },
    'roof2':   { sheet: 'roofs', r: 1, c: 6 },

    // ============ 建筑墙（4_buildings.png）============
    'wall':    { sheet: 'buildings', r: 3, c: 18 },
    'wall2':   { sheet: 'buildings', r: 12, c: 16 },
    'wall3':   { sheet: 'buildings', r: 18, c: 8 },

    // ============ 植物（3_plants.png）============
    'grassTuft': { sheet: 'plants', r: 1, c: 0 },
    'bush':      { sheet: 'plants', r: 1, c: 4 }
  };

  /** 可通行判定 */
  T.WALKABLE = {
    grass: true, grass2: true, grass3: true, grass4: true,
    stone: true, stone2: true, brick: true,
    dirt: true, dirt2: true, sand: true,
    cliffGrass: true,
    floorWood: true, floorWood2: true, floorStone: true, floorStone2: true,
    water: false, water2: false,
    roof: false, roof2: false,
    wall: false, wall2: false, wall3: false,
    grassTuft: true, bush: false
  };

  T.isWalkable = function (name) {
    var v = T.WALKABLE[name];
    return v === undefined ? true : v;
  };

  /** 哪些瓦片带透明（装饰物，绘制时不铺底） */
  T.IS_DECO = {
    grassTuft: true, bush: true
  };

  // =====================================================================
  // 加载
  // =====================================================================
  T.load = function (onProgress) {
    var names = Object.keys(T.SHEETS);
    var total = names.length;
    var done = 0;

    return Promise.all(names.map(function (name) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          T.sheets[name] = img;
          done++;
          if (onProgress) onProgress(done, total, name);
          resolve(true);
        };
        img.onerror = function () {
          console.warn('[tiles16] 加载失败: ' + T.SHEETS[name]);
          done++;
          if (onProgress) onProgress(done, total, name + '(失败)');
          resolve(false);
        };
        img.src = T.SHEETS[name] + '?v=2';
      });
    })).then(function () {
      T.ok = Object.keys(T.sheets).length > 0;
      console.log('[tiles16] 图集 ' + Object.keys(T.sheets).length + '/' + total);
      return T.ok;
    });
  };

  /** 取瓦片绘制参数 */
  T.get = function (name) {
    var d = T.DEFS[name];
    if (!d) return null;
    var img = T.sheets[d.sheet];
    if (!img) return null;
    return {
      img: img,
      sx: d.c * T.SIZE,
      sy: d.r * T.SIZE,
      sw: T.SIZE,
      sh: T.SIZE
    };
  };

  /** render2d.drawMap 适配器 */
  T.adapter = function () {
    return { getTile: function (id) { return T.get(id); } };
  };

  // =====================================================================
  // 角色
  // =====================================================================
  /**
   * 取角色帧。
   * @param {number} dir   0=下 1=上 2=左 3=右
   * @param {number} frame 0~6
   */
  T.charFrame = function (dir, frame) {
    var img = T.sheets.chars;
    if (!img) return null;
    var d = Math.max(0, Math.min(T.CHAR_DIRS - 1, dir | 0));
    var f = Math.max(0, Math.min(T.CHAR_FRAMES - 1, frame | 0));
    return {
      img: img,
      sx: f * T.CHAR_W,
      sy: d * T.CHAR_H,
      sw: T.CHAR_W,
      sh: T.CHAR_H
    };
  };

})(window.G = window.G || {});
