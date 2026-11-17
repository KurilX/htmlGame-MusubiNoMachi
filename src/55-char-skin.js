/* 55-char-skin.js — 给角色加外观（发型 / 和服配色）
 *
 * 【为什么需要】
 * RPG16 的 14_human_sprite_base.png 是**裸模**：光头、白身、红色裤子。
 * 用户反馈"角色有点太丑了，怎么全是光头"。
 *
 * 素材包里没有配套的发型/服装图层（已确认：zip 里只有这一个角色图集）。
 *
 * 【做法：程序化叠层，不重画原图】
 * 在离屏 canvas 上：
 *   1) 先画原始帧（保证四向行走的动作全对）
 *   2) 再按像素坐标覆盖：头顶画头发、躯干画和服、腰部画腰带
 *
 * 关键：**所有覆盖都按像素精确坐标**，来自对原图的逐行扫描：
 *   y 14~22  头部（肤色）
 *   y 22~30  头发/脖子过渡
 *   y 30~38  上身
 *   y 38~48  裤/裙
 *   y 48~50  脚
 *
 * 【为什么不用 assets/pack/chars 的守卫】
 * 那 6 个角色是 768×192、**只有朝下方向**，没有左右上下四向，
 * 无法用于 2D 四向行走。
 */
(function (G) {
  'use strict';

  var S = G.charSkin = {};

  S.TILE_W = 32;   // 单帧宽
  S.TILE_H = 64;   // 单帧高

  // 原图里各部分的行范围（逐行扫描实测）
  S.HEAD_TOP = 13;
  S.HEAD_BOT = 23;     // 头顶到下巴
  S.HAIR_TOP = 13;     // 头发从这里开始盖
  S.HAIR_BOT = 24;
  S.BODY_TOP = 29;
  S.BODY_BOT = 39;     // 和服覆盖范围
  S.LEG_TOP = 39;
  S.LEG_BOT = 48;

  /** 预设外观 */
  S.LOOKS = {
    // 玩家：深蓝和服 + 黑发
    player: {
      hair: '#2E2A38', hairHi: '#332E40',
      robe: '#3E5A8C', robeHi: '#5578B0', robeSh: '#2A3E62',
      obi: '#D8B45A', obiSh: '#A88838'
    },
    // NPC：粉和服 + 棕发
    npcA: {
      hair: '#5A3A2A', hairHi: '#634234',
      robe: '#D888A8', robeHi: '#F0A8C4', robeSh: '#B06888',
      obi: '#7FB069', obiSh: '#5C8A4A'
    },
    // NPC：绿和服 + 灰发（老人）
    npcB: {
      hair: '#A8A8B0', hairHi: '#B0B0B8',
      robe: '#6B8A5A', robeHi: '#8AA878', robeSh: '#4E6642',
      obi: '#8A6A3A', obiSh: '#6A4E28'
    },
    // NPC：米白和服 + 黑发（女性）
    npcC: {
      hair: '#241E28', hairHi: '#2A2430',
      robe: '#E8E0D0', robeHi: '#FFF8EC', robeSh: '#C0B8A8',
      obi: '#C05A5A', obiSh: '#963E3E'
    },
    // NPC：紫和服 + 深发
    npcD: {
      hair: '#3A2A38', hairHi: '#42323F',
      robe: '#7A5A8C', robeHi: '#9C7EB0', robeSh: '#5A4068',
      obi: '#E8C25A', obiSh: '#B89840'
    }
  };

  /**
   * 给一个角色帧加上外观。
   * @param {CanvasRenderingContext2D} srcCtx 原图集上下文
   * @param {number} dir   0=下 1=上 2=左 3=右
   * @param {number} frame 0~6
   * @param {object} look  外观配置
   * @returns {HTMLCanvasElement} 合成后的 32×64 画布
   */
  S.compose = function (srcCtx, dir, frame, look) {
    var W = S.TILE_W, H = S.TILE_H;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;

    // ---- 1. 先画原始帧（保证动作正确）----
    g.drawImage(
      srcCtx.canvas,
      frame * 32, dir * 64, 32, 64,
      0, 0, 32, 64
    );

    // ---- 2. 换衣服（覆盖躯干与腿）----
    //
    // 用 source-atop 保证只覆盖原图已有的不透明像素，
    // 不会把透明背景涂成色块。
    g.globalCompositeOperation = 'source-atop';

    // 躯干：和服主色
    g.fillStyle = look.robe;
    g.fillRect(4, S.BODY_TOP, 24, S.BODY_BOT - S.BODY_TOP);

    // 躯干高光（左侧受光，2px 宽即可，别太宽否则像花纹）
    g.fillStyle = look.robeHi;
    g.fillRect(5, S.BODY_TOP + 1, 2, S.BODY_BOT - S.BODY_TOP - 2);

    // 躯干暗部（右侧）
    g.fillStyle = look.robeSh;
    g.fillRect(26, S.BODY_TOP, 2, S.BODY_BOT - S.BODY_TOP);

    // 腰带（只占 2px，不要宽条）
    //
    // 【踩过的坑】第一版画了 3px 高 + 底部再加 1px 暗线 = 4px，
    // 而躯干本身只有 10px 高，腰带占了近一半，看起来像救生圈。
    g.fillStyle = look.obi;
    g.fillRect(4, S.BODY_BOT - 2, 24, 2);

    // 腿部（裤/裙）：用和服暗色，不再是大红裤
    g.fillStyle = look.robeSh;
    g.fillRect(4, S.BODY_BOT, 24, S.LEG_BOT - S.BODY_BOT);

    // ---- 3. 加头发 ----
    //
    // 头顶到下巴之间的上半部分是头发覆盖区。
    // 不同朝向要留出脸的位置：
    //   朝下(0)：额头以上盖住，下巴露脸
    //   朝上(1)：整个后脑全是头发
    //   左(2)/右(3)：盖右半边或左半边
    g.fillStyle = look.hair;

    if (dir === 1) {
      // 朝上：整块后脑都是头发
      g.fillRect(5, S.HAIR_TOP, 22, S.HEAD_BOT - S.HAIR_TOP + 2);
    } else if (dir === 0) {
      // 朝下：盖额头，留出脸
      g.fillRect(5, S.HAIR_TOP, 22, 7);
      // 两侧鬓角
      g.fillRect(5, S.HAIR_TOP + 7, 3, 5);
      g.fillRect(24, S.HAIR_TOP + 7, 3, 5);
    } else if (dir === 2) {
      // 朝左：头发偏后半边
      g.fillRect(5, S.HAIR_TOP, 22, 8);
      g.fillRect(16, S.HAIR_TOP + 8, 11, 6);
    } else {
      // 朝右
      g.fillRect(5, S.HAIR_TOP, 22, 8);
      g.fillRect(5, S.HAIR_TOP + 8, 11, 6);
    }

    // 头发高光
    //
    // 【踩过的坑】第一版画了 12px 宽 × 2px 高的亮条，
    // 小尺寸下看起来像"头上一道黄线"。
    // 改成：只在头顶偏左画一小块柔和高光（4×2），并降低对比。
    if (dir !== 1) {
      g.fillStyle = look.hairHi;
      g.fillRect(9, S.HAIR_TOP + 1, 4, 2);
    } else {
      // 朝上看不到高光，只在后脑留一点点
      g.fillStyle = look.hairHi;
      g.fillRect(10, S.HAIR_TOP + 1, 3, 1);
    }

    g.globalCompositeOperation = 'source-over';
    return cv;
  };

  // =====================================================================
  // 预合成整张图集（性能关键：每帧只做一次）
  // =====================================================================
  S._cache = {};

  /**
   * 为某个外观生成**完整的四向图集**（4 行 × 7 帧）。
   * 返回 { canvas, ready }
   */
  S.sheetFor = function (lookName) {
    if (S._cache[lookName]) return S._cache[lookName];

    var look = S.LOOKS[lookName] || S.LOOKS.player;
    var srcImg = G.tiles16 && G.tiles16.sheets.chars;
    if (!srcImg) return null;

    // 原图集需要一个 ctx 才能被 drawImage 裁切
    var srcCv = document.createElement('canvas');
    srcCv.width = srcImg.width;
    srcCv.height = srcImg.height;
    var srcCtx = srcCv.getContext('2d');
    srcCtx.imageSmoothingEnabled = false;
    srcCtx.drawImage(srcImg, 0, 0);

    var sheetW = 32 * 7;
    var sheetH = 64 * 4;
    var out = document.createElement('canvas');
    out.width = sheetW;
    out.height = sheetH;
    var g = out.getContext('2d');
    g.imageSmoothingEnabled = false;

    for (var d = 0; d < 4; d++) {
      for (var f = 0; f < 7; f++) {
        var frameCv = S.compose(srcCtx, d, f, look);
        g.drawImage(frameCv, f * 32, d * 64);
      }
    }

    var rec = { canvas: out, ready: true };
    S._cache[lookName] = rec;
    return rec;
  };

  /** 取某一帧 */
  S.frame = function (lookName, dir, frame) {
    var sheet = S.sheetFor(lookName);
    if (!sheet) return null;
    return {
      img: sheet.canvas,
      sx: frame * 32,
      sy: dir * 64,
      sw: 32,
      sh: 64
    };
  };

  /** 预热全部外观（启动时调一次） */
  S.prewarm = function (names) {
    (names || Object.keys(S.LOOKS)).forEach(function (n) {
      S.sheetFor(n);
    });
  };

})(window.G = window.G || {});
