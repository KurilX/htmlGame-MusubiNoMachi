/* 20-art-chibi.js — 角色立绘程序化绘制（v3：5.5 头身）
 *
 * 【重大改版说明】
 * 用户提供了风格参考图，图中角色是 **5~6 头身的少年**，五官精致、脸型修长。
 * 而我之前做的是 2.5 头身的大头娃娃（放置手游风格），方向本身错了。
 *
 * v3 的关键变化：
 *   - 比例：2.5 头身 -> **5.5 头身**（画布 48x64 -> 64x96）
 *   - 头：从"大圆脸"改成"修长鹅蛋脸"，下巴收尖
 *   - 眼睛：从"占半张脸的大圆眼"改成"细长杏眼"，位于脸的中线略上
 *   - 身体：从"梯形色块"改成有明确肩线、腰线、胯线的躯干
 *   - 四肢：从"粗短柱"改成有粗细变化的手臂/大腿/小腿
 *
 * 比例计算（96px 高，5.5 头身 -> 头高 17.5px）：
 *   头(含发) 17.5 / 脖子 1.7 / 躯干 27.9 / 大腿 23.6 / 小腿 21.8 / 脚 3.5
 */
(function (G) {
  'use strict';

  var CW = 64, CH = 96;
  var FEET_Y = 92;

  var PX = {
    rect: function (ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); },
    px: function (ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); },
    ell: function (ctx, cx, cy, rx, ry, c) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // ---------- 配色（对齐参考图：高明度、低饱和、阴影带冷色） ----------
  var DEFAULT_LOOK = {
    skin:     '#FCE4D6',
    skinSh:   '#E8BCA8',
    skinHi:   '#FFF2E8',
    hair:     '#3A2E36',
    hairSh:   '#2A2028',
    hairHi:   '#6A5560',
    eye:      '#3A4A5E',
    eyeHi:    '#8FC4D8',
    lash:     '#1E161C',
    kimono:   '#7FA8C8',
    kimonoSh: '#5C82A0',
    kimonoHi: '#A0C4DC',
    collar:   '#FBF3E4',
    obi:      '#C8483C',
    obiSh:    '#A03028',
    pants:    '#D8D0C0',
    pantsSh:  '#B8B0A0',
    boot:     '#5B4A44',
    blade:    '#DCE6EC',
    bladeHi:  '#FFFFFF',
    hilt:     '#3A2E2A',
    hairStyle: 'bob'
  };

  G.makeLook = function (over) {
    var o = {};
    for (var k in DEFAULT_LOOK) o[k] = DEFAULT_LOOK[k];
    if (over) for (var k2 in over) o[k2] = over[k2];
    return o;
  };

  // =====================================================================
  // 核心绘制
  // =====================================================================
  function drawChibi(ctx, L, dir, phase, f, animT) {
    ctx.clearRect(0, 0, CW, CH);
    ctx.imageSmoothingEnabled = false;

    var cx = CW / 2;
    var bob = 0, lean = 0, armSwing = 0, legSwing = 0, legLift = 0;

    if (phase === 'walk') {
      var step = [0, 1, 0, -1][f % 4];
      bob = [0, -1, 0, -1][f % 4];
      legSwing = step * 2;
      legLift = Math.max(0, step) * 1;
      armSwing = -step * 2;
    } else if (phase === 'idle') {
      bob = [0, 1][f % 2];
    } else if (phase === 'attack') {
      var t = [0, 1, 2][f % 3];
      if (t === 0) { lean = -1; }
      else if (t === 1) { lean = 3; bob = -1; }
      else { lean = 0; bob = 1; }
    } else if (phase === 'hurt') {
      lean = -3; bob = 1;
    } else if (phase === 'dead') {
      bob = 4 + (f % 3);
    }

    var facing = dir;
    var isBack = (facing === 4 || facing === 3 || facing === 5);
    var isSide = (facing === 2 || facing === 6);
    var flipX = (facing === 2 || facing === 3 || facing === 7);
    var bodyFacing = isSide ? 'side' : (isBack ? 'back' : 'front');

    ctx.save();
    if (flipX) { ctx.translate(CW, 0); ctx.scale(-1, 1); }
    ctx.translate(lean, bob);

    var gY = FEET_Y;

    // ============ 关键比例锚点（5.5 头身） ============
    //
    // 比例迭代记录：
    //  v1 腿从 hipY(44.5) 到 ankleY(89)，长 44.5px —— 占画面一半，
    //     加上裤子是浅白色，看起来像穿了两条白长条 / 踩高跷。
    //  v2 现在：把腿部区间缩短（脚踝上提到 84），并加深裤袜颜色，
    //     同时用裙摆盖住大腿上部，让"露出的小腿"成为视觉主体。
    var HEAD_H = 17.5;
    var headTop = 4;
    var headCy = headTop + HEAD_H * 0.5;
    var headW = 13;
    var headH = 15;

    var neckY = headTop + HEAD_H;
    var shoulderY = neckY + 2;
    var waistY = shoulderY + 13;
    var hipY = shoulderY + 21;
    var ankleY = gY - 4;          // 脚踝上提，腿占比降低

    var shoulderW = 15;
    var waistW = 11;
    var hipW = 13;

    // ============ 腿（有粗细变化，带膝盖） ============
    // 踩过的坑：初版腿被躯干衣摆完全盖住（衣摆画到 hipY+2，腿从 hipY 开始），
    // 结果胯以下是一整块白色，看起来像穿了长裙没有腿。
    // 修法：衣摆只到 hipY，腿从 hipY 往下画，且左右腿之间留 1px 缝。
    function drawLeg(x, lift, isNear) {
      var top = hipY;
      var bot = ankleY - lift;
      var thighW = 5;
      var calfW = 4;
      var kneeMid = top + (bot - top) * 0.45;

      // 大腿
      PX.rect(ctx, x - thighW / 2, top, thighW, kneeMid - top, isNear ? L.pants : L.pantsSh);
      // 小腿（略细）
      PX.rect(ctx, x - calfW / 2, kneeMid, calfW, bot - kneeMid, isNear ? L.pants : L.pantsSh);
      // 膝盖阴影
      PX.rect(ctx, x - thighW / 2, kneeMid - 1, thighW, 1, L.pantsSh);
      // 裤脚暗边
      PX.rect(ctx, x - calfW / 2, bot - 1, calfW, 1, L.pantsSh);
      // 鞋
      PX.rect(ctx, x - calfW / 2 - 0.5, bot, calfW + 1, 2, L.boot);
    }

    if (bodyFacing === 'side') {
      drawLeg(cx - 2 + legSwing, legLift, true);
      drawLeg(cx + 2 - legSwing, 0, false);
    } else {
      // 左右腿分开：cx-3 和 cx+3，各宽 5，中间留 1px 缝
      drawLeg(cx - 3 + legSwing * 0.6, legLift, true);
      drawLeg(cx + 3 - legSwing * 0.6, 0, false);
    }

    // ============ 躯干（有肩/腰/胯的轮廓，不是梯形） ============
    // 上身：肩宽 -> 腰窄
    ctx.fillStyle = L.kimono;
    ctx.beginPath();
    ctx.moveTo(cx - shoulderW / 2, shoulderY);
    ctx.lineTo(cx + shoulderW / 2, shoulderY);
    ctx.lineTo(cx + waistW / 2, waistY);        // 收腰
    ctx.lineTo(cx - waistW / 2, waistY);
    ctx.closePath();
    ctx.fill();

    // 下身（衣摆）：腰 -> 胯，略微外扩
    // 注意：衣摆下沿止于 hipY，不要画到 hipY+2，
    // 否则会盖住大腿根部，看起来像没有腿（踩过）。
    // 另外：衣摆要"盖住大腿上半部"才像和服下摆，所以画到 hipY 之后
    // 再补一段稍微收窄的裙摆，覆盖大腿 1/3。
    ctx.beginPath();
    ctx.moveTo(cx - waistW / 2, waistY);
    ctx.lineTo(cx + waistW / 2, waistY);
    ctx.lineTo(cx + hipW / 2, hipY);
    ctx.lineTo(cx - hipW / 2, hipY);
    ctx.closePath();
    ctx.fill();

    // 裙摆（覆盖大腿上部，让腿不至于从腰直接开始）
    var hemY = hipY + 9;
    ctx.beginPath();
    ctx.moveTo(cx - hipW / 2, hipY);
    ctx.lineTo(cx + hipW / 2, hipY);
    ctx.lineTo(cx + hipW / 2 - 1, hemY);
    ctx.lineTo(cx - hipW / 2 + 1, hemY);
    ctx.closePath();
    ctx.fill();
    // 裙摆下沿暗边
    ctx.fillStyle = L.kimonoSh;
    ctx.globalAlpha = 0.5;
    PX.rect(ctx, cx - hipW / 2 + 1, hemY - 1, hipW - 2, 1, L.kimonoSh);
    ctx.globalAlpha = 1;

    // 亮面（左肩受光）
    ctx.fillStyle = L.kimonoHi;
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    ctx.moveTo(cx - shoulderW / 2 + 1, shoulderY + 1);
    ctx.lineTo(cx - 2, shoulderY + 1);
    ctx.lineTo(cx - waistW / 2 + 2, hipY);
    ctx.lineTo(cx - hipW / 2 + 1, hipY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // 暗面（右侧）
    ctx.fillStyle = L.kimonoSh;
    ctx.beginPath();
    ctx.moveTo(cx + shoulderW / 2 - 3, shoulderY);
    ctx.lineTo(cx + shoulderW / 2, shoulderY);
    ctx.lineTo(cx + waistW / 2, waistY);
    ctx.lineTo(cx + waistW / 2 - 3, waistY);
    ctx.closePath();
    ctx.fill();

    // 衣襟 V 领（和服关键特征）
    if (bodyFacing === 'front') {
      ctx.fillStyle = L.collar;
      ctx.beginPath();
      ctx.moveTo(cx - 4, shoulderY);
      ctx.lineTo(cx, shoulderY + 7);
      ctx.lineTo(cx + 4, shoulderY);
      ctx.lineTo(cx + 2, shoulderY);
      ctx.lineTo(cx, shoulderY + 4);
      ctx.lineTo(cx - 2, shoulderY);
      ctx.closePath();
      ctx.fill();
    }

    // 腰带（在腰线位置，细带）
    var obiH = 4;
    var obiY = waistY - 1;
    PX.rect(ctx, cx - waistW / 2 - 0.5, obiY, waistW + 1, obiH, L.obi);
    PX.rect(ctx, cx - waistW / 2 - 0.5, obiY, waistW + 1, 1, L.obiSh);
    if (bodyFacing === 'front') {
      PX.rect(ctx, cx + 1, obiY - 2, 4, 3, L.obi);
      PX.rect(ctx, cx + 2, obiY - 1, 2, 1, L.obiSh);
    } else if (bodyFacing === 'back') {
      PX.rect(ctx, cx - 3, obiY - 2, 6, 4, L.obi);
      PX.rect(ctx, cx - 2, obiY - 1, 4, 2, L.obiSh);
    }

    // 下摆褶皱
    for (var pf = 0; pf < 3; pf++) {
      ctx.globalAlpha = 0.25;
      PX.rect(ctx, cx - 4 + pf * 4, hipY - 4, 1, 5, L.kimonoSh);
      ctx.globalAlpha = 1;
    }

    // ============ 手臂（肩->肘->手，有粗细变化） ============
    function drawArm(sx, swing, isNear) {
      var armW = 4;
      var elbowY = shoulderY + 10;
      var wristY = shoulderY + 19;

      // 上臂
      PX.rect(ctx, sx - armW / 2 + swing, shoulderY + 1, armW, elbowY - shoulderY, isNear ? L.kimono : L.kimonoSh);
      // 前臂（略细）
      PX.rect(ctx, sx - 1.5 + swing, elbowY, 3, wristY - elbowY, isNear ? L.kimono : L.kimonoSh);
      // 袖口
      PX.rect(ctx, sx - 1.5 + swing, elbowY - 1, 3, 1, L.kimonoSh);
      // 手
      PX.rect(ctx, sx - 1.5 + swing, wristY, 3, 3, isNear ? L.skin : L.skinSh);
    }

    var armSwingPx = armSwing;
    if (phase === 'attack' && (f % 3) === 1) {
      // 挥刀：前臂向前伸
      PX.rect(ctx, cx + shoulderW / 2 - 1, shoulderY + 2, 10, 4, L.kimono);
      PX.rect(ctx, cx + shoulderW / 2 - 1, shoulderY + 2, 10, 1, L.kimonoHi);
      PX.rect(ctx, cx + shoulderW / 2 + 8, shoulderY + 3, 4, 3, L.skin);
    } else {
      drawArm(cx - shoulderW / 2 + 1, armSwingPx, false);
      drawArm(cx + shoulderW / 2 - 1, -armSwingPx, true);
    }

    // ============ 刀 ============
    if (phase === 'attack' && (f % 3) === 1) {
      ctx.fillStyle = 'rgba(220,230,236,0.45)';
      ctx.beginPath();
      ctx.arc(cx + shoulderW / 2 + 6, shoulderY + 8, 18, -1.1, 0.7);
      ctx.lineTo(cx + shoulderW / 2 + 6, shoulderY + 8);
      ctx.fill();
      PX.rect(ctx, cx + shoulderW / 2 + 11, shoulderY - 6, 2, 20, L.blade);
      PX.rect(ctx, cx + shoulderW / 2 + 11, shoulderY - 6, 1, 20, L.bladeHi);
      PX.rect(ctx, cx + shoulderW / 2 + 11, shoulderY + 13, 2, 4, L.hilt);
    } else {
      // 佩刀：贴在腰侧，刀鞘斜向下（不穿身体、不浮空）
      //
      // 踩过的坑：初版用 shX - i*0.7 / shY - i*0.45 画了一条
      // 向左上延伸的线，结果刀飘在身体外面、看起来像根树枝。
      // 正确做法：刀柄在腰带左侧（贴着身体），鞘顺着胯部斜向下。
      var shX = cx - waistW / 2;
      var shY = obiY + 1;
      for (var i = 0; i < 13; i++) {
        // 向右下方延伸（贴住腰胯轮廓）
        PX.px(ctx, shX + i * 0.55, shY + i * 0.5, L.hilt);
      }
      // 刀柄（在腰带位置，向左上一点）
      PX.rect(ctx, shX - 2, shY - 2, 4, 2, L.hilt);
      PX.px(ctx, shX - 2, shY - 2, L.bladeHi);
      // 鞘尖高光
      PX.px(ctx, shX + 12 * 0.55, shY + 12 * 0.5, L.bladeHi);
    }

    // ============ 脖子 ============
    PX.rect(ctx, cx - 2, neckY - 1, 4, 3, L.skinSh);

    // ============ 头（修长鹅蛋脸，不是大圆脸） ============
    // 脸型：上宽下窄的鹅蛋形
    ctx.fillStyle = L.skin;
    ctx.beginPath();
    ctx.ellipse(cx, headCy + 1, headW / 2, headH / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // 下巴收窄（在椭圆下方补一个三角，让脸型更尖）
    ctx.beginPath();
    ctx.moveTo(cx - 4.5, headCy + 5);
    ctx.lineTo(cx + 4.5, headCy + 5);
    ctx.lineTo(cx, headCy + headH / 2 + 1);
    ctx.closePath();
    ctx.fill();
    // 侧脸阴影
    if (bodyFacing === 'side') {
      ctx.fillStyle = L.skinSh;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.ellipse(cx - 2, headCy + 1, headW / 2 - 2, headH / 2 - 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ============ 头发（圆润轮廓 + 刘海） ============
    if (bodyFacing !== 'back') {
      // 头发外轮廓：比头略大
      ctx.fillStyle = L.hair;
      ctx.beginPath();
      ctx.ellipse(cx, headCy - 1, headW / 2 + 1.5, headH / 2 + 1, 0, 0, Math.PI * 2);
      ctx.fill();
      // 重新挖回脸（下半部）
      ctx.fillStyle = L.skin;
      ctx.beginPath();
      ctx.ellipse(cx, headCy + 3, headW / 2 - 0.5, headH / 2 - 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 下巴尖
      ctx.beginPath();
      ctx.moveTo(cx - 4.5, headCy + 5);
      ctx.lineTo(cx + 4.5, headCy + 5);
      ctx.lineTo(cx, headCy + headH / 2 + 1);
      ctx.closePath();
      ctx.fill();

      // 刘海：横向发帘盖住额头
      ctx.fillStyle = L.hair;
      ctx.beginPath();
      ctx.ellipse(cx, headCy - 3, headW / 2 + 1, 5, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - headW / 2 - 1, headCy - 3, headW + 2, 1);

      // 侧发（垂到肩）
      PX.rect(ctx, cx - headW / 2 - 1, headCy - 1, 3, 20, L.hair);
      PX.rect(ctx, cx + headW / 2 - 2, headCy - 1, 3, 20, L.hairSh);
      // 发梢收窄
      PX.rect(ctx, cx - headW / 2 - 1, headCy + 18, 2, 3, L.hair);
      PX.rect(ctx, cx + headW / 2 - 1, headCy + 18, 2, 3, L.hairSh);

      // 头发高光
      ctx.fillStyle = L.hairHi;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse(cx - 2, headCy - 6, 4, 1.5, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // 背面：后脑勺（有发旋高光）
      ctx.fillStyle = L.hair;
      ctx.beginPath();
      ctx.ellipse(cx, headCy, headW / 2 + 1, headH / 2 + 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = L.hairHi;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.ellipse(cx - 1, headCy - 3, 4, 2, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // 后颈发
      PX.rect(ctx, cx - 5, headCy + 6, 10, 8, L.hair);
    }

    // ============ 五官（细长杏眼，位于脸中线略上） ============
    if (bodyFacing === 'front') {
      var eyeY = headCy + 1;

      [-1, 1].forEach(function (side) {
        var ex = cx + side * 3.5;

        // 眼白：细长（3 宽 2 高，不是方块）
        PX.rect(ctx, ex - 1.5, eyeY, 3, 2, '#FFFFFF');
        // 瞳孔
        PX.rect(ctx, ex - 1, eyeY, 2, 2, L.eye);
        // 高光
        PX.px(ctx, ex - 1, eyeY, '#FFFFFF');
        // 上睫毛（细，压在眼白上方）
        PX.rect(ctx, ex - 1.5, eyeY - 1, 3, 1, L.lash);
        // 外眼角上挑
        PX.px(ctx, ex + (side < 0 ? -2 : 1), eyeY - 1, L.lash);
      });

      // 眉毛（细长，略上挑）
      PX.rect(ctx, cx - 5, eyeY - 3, 3, 1, L.hairSh);
      PX.rect(ctx, cx + 2, eyeY - 3, 3, 1, L.hairSh);

      // 腮红
      ctx.globalAlpha = 0.3;
      PX.rect(ctx, cx - 7, eyeY + 2, 2, 1, '#F0A0A8');
      PX.rect(ctx, cx + 5, eyeY + 2, 2, 1, '#F0A0A8');
      ctx.globalAlpha = 1;

      // 鼻子（1px）
      PX.px(ctx, cx, eyeY + 3, L.skinSh);
      // 嘴（1px 短线）
      PX.rect(ctx, cx - 1, eyeY + 5, 2, 1, L.skinSh);

    } else if (bodyFacing === 'side') {
      var eyeY2 = headCy + 1;
      var ex2 = cx + 2;
      PX.rect(ctx, ex2 - 1, eyeY2, 3, 2, '#FFFFFF');
      PX.rect(ctx, ex2, eyeY2, 2, 2, L.eye);
      PX.px(ctx, ex2, eyeY2, '#FFFFFF');
      PX.rect(ctx, ex2 - 1, eyeY2 - 1, 3, 1, L.lash);
      PX.rect(ctx, cx + 4, eyeY2 + 4, 2, 1, L.skinSh);
    }

    ctx.restore();

    // 接地阴影
    ctx.save();
    ctx.translate(lean, bob);
    ctx.globalAlpha = 0.2;
    PX.ell(ctx, cx, gY + 1, 12, 3, '#000000');
    ctx.globalAlpha = 1;
    ctx.restore();

    // 受击闪红
    if (phase === 'hurt') {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(255,120,120,0.4)';
      ctx.fillRect(0, 0, CW, CH);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // =====================================================================
  // 构建 atlas
  // =====================================================================
  var PHASES = { idle: 2, walk: 4, attack: 3, hurt: 1, dead: 3 };
  var DIRS = 8;

  G.buildChibiAtlas = function (look, opt) {
    opt = opt || {};
    var cw = CW, ch = CH;
    var rowsPlan = [];
    var totalRows = 0;
    for (var p in PHASES) {
      rowsPlan.push({ phase: p, count: PHASES[p], startRow: totalRows });
      totalRows += PHASES[p];
    }
    var atlas = G.makeCanvas(cw * DIRS, ch * totalRows);
    var actx = atlas.getContext('2d');
    actx.imageSmoothingEnabled = false;

    var frameInfo = {};
    for (var i = 0; i < rowsPlan.length; i++) {
      var plan = rowsPlan[i];
      frameInfo[plan.phase] = { startRow: plan.startRow, count: plan.count };
      for (var d = 0; d < DIRS; d++) {
        for (var f = 0; f < plan.count; f++) {
          var cell = G.makeCanvas(cw, ch);
          var cctx = cell.getContext('2d');
          cctx.imageSmoothingEnabled = false;
          drawChibi(cctx, look, d, plan.phase, f, plan.count > 1 ? f / (plan.count - 1) : 0);
          actx.drawImage(cell, d * cw, (plan.startRow + f) * ch);
        }
      }
    }

    var tex = G.canvasTexture(atlas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;

    return {
      canvas: atlas, tex: tex, frames: frameInfo,
      cw: cw, ch: ch, cols: DIRS, rows: totalRows, look: look
    };
  };

  G.makeChibiMesh = function (atlas, opt) {
    opt = opt || {};
    var worldH = opt.worldH || 2.2;
    var worldW = worldH * (atlas.cw / atlas.ch);

    var geo = new THREE.PlaneGeometry(worldW, worldH);
    var mat = new THREE.MeshBasicMaterial({
      map: atlas.tex, transparent: true, alphaTest: 0.5,
      side: THREE.DoubleSide, depthWrite: true, fog: true
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.userData.atlas = atlas;
    mesh.userData.worldH = worldH;
    mesh.userData.worldW = worldW;
    mesh.userData.uvState = { dir: 0, row: 0 };
    setFrame(mesh, 0, 0);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  };

  function setFrame(mesh, dir, row) {
    var atlas = mesh.userData.atlas;
    if (!atlas) return;
    var uv = mesh.geometry.attributes.uv;
    if (!uv) return;
    var sx = 1 / atlas.cols;
    var sy = 1 / atlas.rows;
    var u0 = dir * sx;
    var v1 = 1 - row * sy;
    var v0 = v1 - sy;
    uv.setXY(0, u0, v1);
    uv.setXY(1, u0 + sx, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u0 + sx, v0);
    uv.needsUpdate = true;
    if (!mesh.userData.uvState) mesh.userData.uvState = { dir: 0, row: 0 };
    mesh.userData.uvState.dir = dir;
    mesh.userData.uvState.row = row;
  }
  G.setChibiFrame = setFrame;

  G.faceCamera = function (mesh, camera) {
    mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z);
  };

})(window.G = window.G || {});
