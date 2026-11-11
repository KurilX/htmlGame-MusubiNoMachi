/* 20-art-chibi.js — chibi 立绘程序化绘制
 *
 * 画法：离屏 canvas 逐帧绘制，转 CanvasTexture，贴在 billboard Plane 上。
 * 8 方向 × (4 帧走路 + 2 帧待机 + 3 帧攻击 + 1 帧受击 + 3 帧死亡)
 *
 * 尺寸：48x64 px（chibi 2.5 头身）。放大到世界 1.6x2.2 单位。
 * 这点很关键：像素是小图 + nearest 放大，和 640x360 的内部渲染分辨率同一粒度。
 */
(function (G) {
  'use strict';

  var CW = 48, CH = 64;          // 单帧像素尺寸
  var FEET_Y = 61;               // 脚底在帧内的 y

  // ---------- 基本画笔 ----------
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

  // ---------- 角色配色（可换装） ----------
  var DEFAULT_LOOK = {
    skin:    '#FCE0CE',
    skinSh:  '#E8BFA8',
    hair:    '#3B2E36',
    hairSh:  '#2A1F26',
    eye:     '#2E4256',
    kimono:  '#8FB8DA',   // 浅靛：和风 + 粉彩
    kimonoSh:'#6E96B8',
    obi:     '#D9483B',   // 朱红腰带
    obiSh:   '#A8302A',
    pants:   '#FBF3E4',
    pantsSh: '#E4D6BE',
    boot:    '#5B4A44',
    blade:   '#DCE6EC',
    hilt:    '#3A2E2A',
    outline: '#3A2E2A'
  };

  /** 生成一个变体格（同一套画法，只换颜色与发型细节） */
  G.makeLook = function (over) {
    var o = {};
    for (var k in DEFAULT_LOOK) o[k] = DEFAULT_LOOK[k];
    if (over) for (var k2 in over) o[k2] = over[k2];
    return o;
  };

  // =====================================================================
  // 核心：画一帧 chibi
  // =====================================================================
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} L     配色
   * @param {number} dir   0..7（0=面向屏幕下方/相机，顺时针）
   * @param {number} phase 动画相位：'idle'|'walk'|'attack'|'hurt'|'dead'
   * @param {number} f     帧序号
   * @param {number} animT 0..1 动画进度（用于攻击/受击）
   */
  function drawChibi(ctx, L, dir, phase, f, animT) {
    ctx.clearRect(0, 0, CW, CH);
    ctx.imageSmoothingEnabled = false;

    var cx = CW / 2;
    var bob = 0;          // 上下浮动
    var lean = 0;         // 横向倾斜
    var bobBob = 0;
    var armSwing = 0;
    var legSwing = 0;

    if (phase === 'walk') {
      // 4 帧：0 中立, 1 左脚前, 2 中立, 3 右脚前
      var step = [0, 1, 0, -1][f % 4];
      bob = [0, -1, 0, -1][f % 4];
      legSwing = step * 2;
      armSwing = -step * 2;
      bobBob = 1;
    } else if (phase === 'idle') {
      bob = [0, 1][f % 2];
    } else if (phase === 'attack') {
      // 3 帧：蓄力(后压) / 斩(前倾) / 收
      var t = [0, 1, 2][f % 3];
      if (t === 0) { lean = -1; bob = 0; }
      else if (t === 1) { lean = 2; bob = -1; }
      else { lean = 0; bob = 1; }
    } else if (phase === 'hurt') {
      lean = -2; bob = 1;
    } else if (phase === 'dead') {
      bob = 3 + (f % 3);
    }

    // ---------- 方向 ----------
    // 0=南(朝相机) 1=西南 2=西 3=西北 4=北(背对) 5=东北 6=东 7=东南
    var facing = dir;
    var isBack = (facing === 4 || facing === 3 || facing === 5);
    var isSide = (facing === 2 || facing === 6);
    var flipX = (facing === 2 || facing === 3 || facing === 7); // 侧面/背侧左右翻转
    var bodyFacing = isSide ? 'side' : (isBack ? 'back' : 'front');

    ctx.save();
    if (flipX) { ctx.translate(CW, 0); ctx.scale(-1, 1); }
    ctx.translate(lean, bob);

    var groundY = FEET_Y;

    // ---------- 腿 ----------
    if (bodyFacing === 'side') {
      // 侧面：前后两条腿
      var lx1 = cx - 3 + legSwing;
      var lx2 = cx + 2 - legSwing;
      PX.rect(ctx, lx1, groundY - 12, 3, 12, L.pants);
      PX.rect(ctx, lx1, groundY - 2, 3, 2, L.boot);
      PX.rect(ctx, lx2, groundY - 12, 3, 12, L.pantsSh);
      PX.rect(ctx, lx2, groundY - 2, 3, 2, L.boot);
    } else {
      // 正面/背面：左右两条腿
      var ly = groundY - 12;
      PX.rect(ctx, cx - 5 + legSwing, ly, 4, 12, L.pants);
      PX.rect(ctx, cx + 1 - legSwing, ly, 4, 12, L.pantsSh);
      PX.rect(ctx, cx - 5 + legSwing, groundY - 2, 4, 2, L.boot);
      PX.rect(ctx, cx + 1 - legSwing, groundY - 2, 4, 2, L.boot);
    }

    // ---------- 身体（和服） ----------
    var bodyTop = groundY - 26;
    var bodyH = 15;
    var bodyY = bodyTop + bobBob;
    // 和服主体：梯形（肩宽 16，下摆 18）
    ctx.fillStyle = L.kimono;
    ctx.beginPath();
    ctx.moveTo(cx - 8, bodyY);
    ctx.lineTo(cx + 8, bodyY);
    ctx.lineTo(cx + 9, bodyY + bodyH);
    ctx.lineTo(cx - 9, bodyY + bodyH);
    ctx.closePath();
    ctx.fill();
    // 阴影侧
    ctx.fillStyle = L.kimonoSh;
    if (bodyFacing === 'side') {
      PX.rect(ctx, cx - 2, bodyY, 5, bodyH, L.kimonoSh);
    } else {
      ctx.fillRect(cx + 3, bodyY, 5, bodyH);
    }
    // 腰带
    if (bodyFacing !== 'back') {
      PX.rect(ctx, cx - 9, bodyY + bodyH - 6, 18, 4, L.obi);
      PX.rect(ctx, cx - 9, bodyY + bodyH - 6, 18, 1, L.obiSh);
      // 结（正面才有）
      if (bodyFacing === 'front') {
        PX.rect(ctx, cx - 2, bodyY + bodyH - 7, 4, 3, L.obi);
      }
    } else {
      // 背面：腰带的结在后腰
      PX.rect(ctx, cx - 9, bodyY + bodyH - 6, 18, 4, L.obiSh);
      PX.rect(ctx, cx - 3, bodyY + bodyH - 7, 6, 5, L.obi);
    }
    // 衣领 V 字（正面）
    if (bodyFacing === 'front') {
      PX.rect(ctx, cx - 2, bodyY, 1, 5, L.pants);
      PX.rect(ctx, cx + 1, bodyY, 1, 5, L.pants);
    }

    // ---------- 手臂 ----------
    var armY = bodyY + 2;
    if (phase === 'attack' && (f % 3) === 1) {
      // 挥砍：前臂前伸
      PX.rect(ctx, cx + 8, armY - 2, 8, 3, L.kimono);
      PX.rect(ctx, cx + 14, armY - 2, 3, 3, L.skin);
    } else if (bodyFacing === 'side') {
      PX.rect(ctx, cx + 4 + armSwing, armY, 3, 9, L.kimono);
      PX.rect(ctx, cx + 4 + armSwing, armY + 9, 3, 3, L.skin);
    } else {
      PX.rect(ctx, cx - 10, armY + armSwing, 3, 9, L.kimonoSh);
      PX.rect(ctx, cx + 7, armY - armSwing, 3, 9, L.kimono);
      PX.rect(ctx, cx - 10, armY + 9 + armSwing, 3, 3, L.skinSh);
      PX.rect(ctx, cx + 7, armY + 9 - armSwing, 3, 3, L.skin);
    }

    // ---------- 刀（挂在腰侧，攻击时前伸） ----------
    if (phase === 'attack' && (f % 3) === 1) {
      // 斩击瞬间：刀身横出 + 残影
      ctx.fillStyle = 'rgba(220,230,236,0.55)';
      ctx.beginPath();
      ctx.arc(cx + 10, armY + 6, 13, -1.0, 0.6);
      ctx.lineTo(cx + 10, armY + 6);
      ctx.fill();
      PX.rect(ctx, cx + 15, armY - 5, 2, 14, L.blade);
      PX.rect(ctx, cx + 15, armY + 7, 2, 3, L.hilt);
    } else if (bodyFacing !== 'back') {
      // 腰侧佩刀（斜插）
      for (var i = 0; i < 9; i++) {
        PX.px(ctx, cx - 11 + i, bodyY + bodyH - 2 - Math.floor(i * 0.5), L.hilt);
      }
      PX.rect(ctx, cx - 4, bodyY + bodyH - 6, 5, 2, L.hilt);
    } else {
      for (var j = 0; j < 9; j++) {
        PX.px(ctx, cx - 11 + j, bodyY + bodyH - 2 - Math.floor(j * 0.5), L.hilt);
      }
    }

    // ---------- 头（2.5 头身：头很大） ----------
    var headCy = bodyY - 8;
    var headR = 8;
    // 后脑（发）
    PX.ell(ctx, cx, headCy, headR + 1, headR + 1, L.hairSh);
    // 脸
    if (bodyFacing === 'back') {
      // 背面：整个后脑是头发
      PX.ell(ctx, cx, headCy, headR, headR, L.hair);
      PX.ell(ctx, cx, headCy + 2, headR - 1, headR - 1, L.hair);
    } else {
      PX.ell(ctx, cx, headCy + 1, headR, headR, L.skin);
      // 脸侧阴影
      if (bodyFacing === 'side') {
        PX.ell(ctx, cx - 2, headCy + 1, headR - 2, headR - 2, L.skinSh);
      }
    }

    // 头发（刘海）
    if (bodyFacing !== 'back') {
      ctx.fillStyle = L.hair;
      ctx.beginPath();
      ctx.ellipse(cx, headCy - 4, headR, headR - 1, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      // 刘海尖角
      PX.rect(ctx, cx - 6, headCy - 3, 3, 4, L.hair);
      PX.rect(ctx, cx + 4, headCy - 3, 3, 4, L.hair);
      PX.rect(ctx, cx - 1, headCy - 2, 2, 3, L.hair);
      // 侧发（垂到肩）
      PX.rect(ctx, cx - headR, headCy - 1, 3, 9, L.hair);
      PX.rect(ctx, cx + headR - 2, headCy - 1, 3, 9, L.hair);
    } else {
      // 背面：后脑勺高光
      PX.rect(ctx, cx - 3, headCy - 8, 6, 2, L.hairSh);
    }

    // ---------- 眼睛（二次元的命） ----------
    if (bodyFacing === 'front') {
      // 大眼：3x4 像素 + 高光，占脸 1/3
      var eyeY = headCy + 2;
      PX.rect(ctx, cx - 5, eyeY, 3, 4, L.eye);
      PX.rect(ctx, cx + 2, eyeY, 3, 4, L.eye);
      // 高光
      PX.px(ctx, cx - 5, eyeY, '#FFFFFF');
      PX.px(ctx, cx + 2, eyeY, '#FFFFFF');
      // 腮红（轻）
      ctx.globalAlpha = 0.45;
      PX.rect(ctx, cx - 7, eyeY + 3, 2, 1, '#F0A0A8');
      PX.rect(ctx, cx + 5, eyeY + 3, 2, 1, '#F0A0A8');
      ctx.globalAlpha = 1;
      // 嘴
      PX.rect(ctx, cx - 1, eyeY + 5, 2, 1, L.skinSh);
    } else if (bodyFacing === 'side') {
      // 侧面：一只眼
      var eyeY2 = headCy + 2;
      PX.rect(ctx, cx + 1, eyeY2, 3, 4, L.eye);
      PX.px(ctx, cx + 1, eyeY2, '#FFFFFF');
    }

    ctx.restore();

    // ---------- 描边（几何像素描边，比 shader 描边更干净） ----------
    // 做法：把 alpha 通道膨胀一圈，涂成描边色，垫在下面
    // 这里用简化版：只加底部接地阴影，实体描边交给后处理
    ctx.save();
    ctx.translate(lean, bob);
    ctx.globalAlpha = 0.22;
    PX.ell(ctx, cx, groundY + 1, 9, 3, '#000000');
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---------- 受击闪白 ----------
    if (phase === 'hurt') {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(255,120,120,0.42)';
      ctx.fillRect(0, 0, CW, CH);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // =====================================================================
  // 构建动画表：把所有帧画到一张 atlas 上，逐帧用纹理偏移
  // =====================================================================
  var PHASES = {
    idle: 2,
    walk: 4,
    attack: 3,
    hurt: 1,
    dead: 3
  };
  var DIRS = 8;

  /**
   * 生成角色贴图集。
   * @returns {{canvas:HTMLCanvasElement, tex:THREE.Texture, frames:Object, cw:number, ch:number, cols:number, rows:number}}
   */
  G.buildChibiAtlas = function (look, opt) {
    opt = opt || {};
    opt = opt || {};
    var cw = CW, ch = CH;
    // 横向：8 方向；纵向：各 phase 的帧叠加
    var rowsPlan = [];
    var totalRows = 0;
    for (var p in PHASES) {
      rowsPlan.push({ phase: p, count: PHASES[p], startRow: totalRows });
      totalRows += PHASES[p];
    }
    var atlas = G.makeCanvas(cw * DIRS, ch * totalRows);
    var actx = atlas.getContext('2d');
    actx.imageSmoothingEnabled = false;

    var frameInfo = {};   // phase -> { startRow, count }
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
      canvas: atlas,
      tex: tex,
      frames: frameInfo,
      cw: cw, ch: ch,
      cols: DIRS,
      rows: totalRows,
      look: look
    };
  };

  /**
   * 用 atlas 创建一个 billboard sprite（始终面向相机的平面）。
   * 注意：等距相机下"always face camera"是等距锁死的，不需要球面 billboard。
   */
  G.makeChibiMesh = function (atlas, opt) {
    opt = opt || {};
    var worldH = opt.worldH || 2.2;
    var worldW = worldH * (atlas.cw / atlas.ch);

    var geo = new THREE.PlaneGeometry(worldW, worldH);
    // UV 默认铺满整张图，下面逐帧改
    var mat = new THREE.MeshBasicMaterial({
      map: atlas.tex,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      depthWrite: true,
      fog: true
    });
    // 手工设置 uv 到第一帧
    var mesh = new THREE.Mesh(geo, mat);
    mesh.userData.atlas = atlas;
    mesh.userData.worldH = worldH;
    mesh.userData.worldW = worldW;
    mesh.userData.uvState = { dir: 0, row: 0 };
    setFrame(mesh, 0, 0);
    mesh.castShadow = false;      // billboard 投阴影会是一块方形，改用贴片阴影
    mesh.receiveShadow = false;
    return mesh;
  };

  /** 直接改几何体的 uv 到指定方向/行 */
  function setFrame(mesh, dir, row) {
    var atlas = mesh.userData.atlas;
    var uv = mesh.geometry.attributes.uv;
    var sx = 1 / atlas.cols;
    var sy = 1 / atlas.rows;
    var u0 = dir * sx;
    var v1 = 1 - row * sy;
    var v0 = v1 - sy;
    // PlaneGeometry 的 uv 顺序：0=(0,1) 1=(1,1) 2=(0,0) 3=(1,0)
    uv.setXY(0, u0, v1);
    uv.setXY(1, u0 + sx, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u0 + sx, v0);
    uv.needsUpdate = true;
    mesh.userData.uvState.dir = dir;
    mesh.userData.uvState.row = row;
  }
  G.setChibiFrame = setFrame;

  /** 让 billboard 始终面向相机（等距下只需绕 Y 轴） */
  G.faceCamera = function (mesh, camera) {
    mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z);
  };

})(window.G = window.G || {});
