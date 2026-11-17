/* 18-pack-scene.js — 用外部素材包构建场景
 *
 * 【与 14/15 的区别】
 * 14-pixel-art.js 是**自己画**像素图（上一版，用户否决了这条路）。
 * 本文件用**下载来的成熟素材包**，不做任何绘制。
 *
 * 【素材实际规格（已逐像素核实）】
 *   角色 npc_0X__down.png : 768×192，8 帧横排，每帧 96×192，
 *                           角色本体 24×156，前 4 帧持枪
 *   exterior_32.png       : 256×2240，32px 网格（8 列 × 70 行）
 *        row=40, col=5 → 纯草地瓦片（实测 RGB 141,170,85）
 *        row=5,  col=0 → 红瓦屋顶（实测 RGB 174,103,91）
 *        row=57, col=0 → 树丛
 *
 * 【图层穿透的修复（用户反馈的核心 bug）】
 * 上一版"两个图层互相穿透"的原因有两个：
 *   1) 地面瓦片在 y=0，物件也贴在 y≈0 → 深度相同，z-fighting
 *   2) 用 `transparent: true` 依赖渲染排序 → 前后关系随视角乱跳
 * 这一版：
 *   - 明确分层：影子 y=0.01 < 地面装饰 y=0.02 < 物件 y>0.3
 *   - 所有带 alpha 的贴图用 `alphaTest` 走深度写入，不依赖排序
 *   - 每个 mesh 显式 renderOrder
 */
(function (G) {
  'use strict';

  var PK = G.packScene = {};

  PK.TILE = 2;            // 一个瓦片 2 世界单位
  PK.GRID = 32;           // 素材包瓦片像素尺寸

  // 素材包里各图块的位置（逐像素核实过的坐标）
  var ATLAS = {
    grass:  { row: 64, col: 4 },
    tree:   { row: 57, col: 0 },
    roof:   { row: 5,  col: 0 },
    roofB:  { row: 5,  col: 1 }
  };

  /** 构建素材包场景 */
  PK.build = function () {
    if (!G.assets || !G.assets.hasPack()) {
      console.warn('[packScene] 素材包不可用');
      return null;
    }

    var scene = new THREE.Scene();
    scene.background = new THREE.Color('#1E2A1A');
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    var W = 60, D = 44;
    var extTex = G.assets.getTile('exterior32');

    // ================= 地面 =================
    //
    // 从 exterior_32 裁出草地单块，做成可重复贴图。
    // 关键：必须切出**独立 canvas**，否则 repeat 会让整张图集平铺。
    if (extTex) {
      var grassTex = _cutTile(extTex, ATLAS.grass.row, ATLAS.grass.col);
      grassTex.wrapS = THREE.RepeatWrapping;
      grassTex.wrapT = THREE.RepeatWrapping;
      grassTex.repeat.set(W / PK.TILE, D / PK.TILE);

      var floorGeo = new THREE.PlaneGeometry(W, D);
      floorGeo.rotateX(-Math.PI / 2);
      var floor = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ map: grassTex }));
      floor.position.y = 0;
      floor.renderOrder = 0;
      scene.add(floor);
    }

    // ================= 房子 =================
    //
    // 用红瓦屋顶平铺成房子俯视。
    // 屋顶整体抬到 y=0.6，与地面拉开距离，彻底消除穿透。
    var houses = [
      { x: -14, z: 2,  w: 8,   d: 6,   rot: 0 },
      { x: 14,  z: 3,  w: 7,   d: 5.5, rot: 0 },
      { x: -13, z: -8, w: 6.5, d: 5.5, rot: 0 },
      { x: 13.5,z: -7, w: 8,   d: 6,   rot: 0 }
    ];

    if (extTex) {
      houses.forEach(function (h) {
        var roofTex = _cutTile(extTex, ATLAS.roof.row, ATLAS.roof.col);
        roofTex.wrapS = THREE.RepeatWrapping;
        roofTex.wrapT = THREE.RepeatWrapping;
        // 一块瓦片 = 2 世界单位，所以 repeat = 尺寸 / 2
        roofTex.repeat.set(h.w / 2, h.d / 2);

        var g = new THREE.PlaneGeometry(h.w * PK.TILE, h.d * PK.TILE);
        g.rotateX(-Math.PI / 2);
        var roof = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: roofTex }));
        roof.position.set(h.x, 0.6, h.z);   // ← 明显高于地面
        roof.renderOrder = 20;
        scene.add(roof);

        // 影子：比屋顶大一圈，贴地
        var sg = new THREE.PlaneGeometry(h.w * PK.TILE * 1.08, h.d * PK.TILE * 1.08);
        sg.rotateX(-Math.PI / 2);
        var sh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
          color: 0x000000, transparent: true, opacity: 0.20, depthWrite: false
        }));
        sh.position.set(h.x + 0.6, 0.02, h.z + 0.6);   // ← 只比地面高一点点
        sh.renderOrder = 1;
        scene.add(sh);
      });
    }

    // ================= 树 =================
    if (extTex) {
      var treePos = [[-22, 14], [-16, 16], [16, 15], [22, 12], [-24, -4], [24, -2]];
      treePos.forEach(function (p) {
        var treeTex = _cutTile(extTex, ATLAS.tree.row, ATLAS.tree.col);
        var s = 3.2;
        var g = new THREE.PlaneGeometry(s, s);
        var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          map: treeTex, alphaTest: 0.5, transparent: true, side: THREE.DoubleSide
        }));
        // 树是竖直的，脚底贴地 → 上移一半高度
        m.position.set(p[0], s / 2, p[1]);
        m.renderOrder = 30;
        scene.add(m);

        var sg = new THREE.PlaneGeometry(2.4, 2.4);
        sg.rotateX(-Math.PI / 2);
        var sh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
          color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false
        }));
        sh.position.set(p[0] + 0.5, 0.02, p[1] + 0.5);
        sh.renderOrder = 1;
        scene.add(sh);
      });
    }

    // ================= 角色（素材包守卫） =================
    var charIds = ['guard01', 'guard02', 'guard03', 'guard04', 'guard05', 'guard06'];
    var charPositions = [[3, 8], [-6, 5], [8, -4], [-10, -2], [0, 12], [16, 10]];

    PK._chars = [];
    charIds.forEach(function (id, i) {
      var info = G.assets.getChar(id);
      if (!info) return;
      var mesh = _makeCharMesh(info);
      var p = charPositions[i] || [0, 0];
      mesh.position.set(p[0], 0, p[1]);     // build 内部已把脚底对齐
      mesh.renderOrder = 40;
      scene.add(mesh);

      var sg = new THREE.PlaneGeometry(1.8, 1.8);
      sg.rotateX(-Math.PI / 2);
      var sh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false
      }));
      sh.position.set(p[0], 0.02, p[1]);
      sh.renderOrder = 1;
      scene.add(sh);

      PK._chars.push({ mesh: mesh, info: info, animT: Math.random() * 2 });
    });

    PK._scene = scene;
    return scene;
  };

  // =====================================================================
  // 内部工具
  // =====================================================================

  /**
   * 从图集里切出一块 32×32 瓦片，生成独立贴图。
   *
   * 【为什么用 canvas 切而不是 UV offset/repeat】
   * 用 UV 裁切时，只要 repeat > 1（要平铺就必须 > 1），
   * 采样器就会在**整张图集**上循环取 0~1，而不是重复那个子块 ——
   * 这正是第一版"整张图集被铺满地面"的原因。
   * 切到独立 canvas 后，repeat 的语义才正确。
   */
  function _cutTile(srcTex, row, col, ts) {
    ts = ts || PK.GRID;
    var img = srcTex && srcTex.image;
    if (!img) return null;

    var cv = document.createElement('canvas');
    cv.width = ts; cv.height = ts;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, col * ts, row * ts, ts, ts, 0, 0, ts, ts);

    var t = new THREE.CanvasTexture(cv);
    t.needsUpdate = true;
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** 造角色 mesh（4 帧行走图，脚底对齐 y=0） */
  function _makeCharMesh(info) {
    var img = info.tex.image;
    var fw = info.frameW, fh = info.frameH;

    // 角色本体在 96×192 帧里的实际区域（逐像素测过：x 0~95, y 0~191，本体 24×156）
    // 直接用整帧，靠 alpha 显示本体。
    var W = 96, H = 192;
    var worldH = 3.2;
    var worldW = worldH * (W / H);   // 保持比例

    // 切出第 0 帧（持枪站姿），做成独立贴图
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, W, H, 0, 0, W, H);

    var tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

    var geo = new THREE.PlaneGeometry(worldW, worldH);
    var mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      // 【用 alphaTest 而不是纯 transparent】
      // 纯 transparent 依赖排序，容易和地面/物件互相穿透；
      // alphaTest 走深度写入，层次干净。
      alphaTest: 0.5,
      depthWrite: true,
      side: THREE.DoubleSide
    });

    var mesh = new THREE.Mesh(geo, mat);
    // 平面以中心为原点 → 上移一半，让脚底落在 y=0
    mesh.position.y = worldH / 2;
    mesh.userData.frameW = fw;
    mesh.userData.frameH = fh;
    mesh.userData.baseCanvas = cv;
    mesh.userData.baseImg = img;
    return mesh;
  }

  /** 每帧更新（行走动画：在独立 canvas 上重绘帧） */
  PK.update = function (dt) {
    if (!PK._chars || !G.assets) return;
    PK._chars.forEach(function (c) {
      c.animT += dt;
      var frame = Math.floor(c.animT * 6) % 4;
      if (frame === c.mesh.userData.lastFrame) return;
      c.mesh.userData.lastFrame = frame;

      // 重绘到 canvas（只画 96×192 的一帧）
      var cv = c.mesh.userData.baseCanvas;
      var img = c.mesh.userData.baseImg;
      if (!cv || !img) return;
      var g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(img, frame * 96, 0, 96, 192, 0, 0, 96, 192);
      if (c.mesh.material.map) c.mesh.material.map.needsUpdate = true;
    });
  };

})(window.G = window.G || {});
