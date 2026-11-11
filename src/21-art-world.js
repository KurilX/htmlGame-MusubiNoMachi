/* 21-art-world.js — 程序化低模场景物件
 *
 * 全部用基础几何体拼接 + 粉彩配色，无外部模型文件。
 * 和风元素：鸟居、纸灯、樱花、石阶、木屋、竹林、溪谷。
 */
(function (G) {
  'use strict';

  var W = G.art = G.art || {};
  var M = G.M;

  // ---------- 材质缓存（同一颜色只建一个材质，减少 draw call state 切换） ----------
  var matCache = {};
  function mat(colorHex, opt) {
    var key = colorHex + '|' + JSON.stringify(opt || {});
    if (!matCache[key]) matCache[key] = G.celMaterial(colorHex, opt);
    return matCache[key];
  }

  function mesh(geo, color, opt) {
    var m = new THREE.Mesh(geo, mat(color, opt));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // ---------- 鸟居 ----------
  W.torii = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var c = opt.color || G.PALETTE.vermilion;
    var h = opt.height || 6;
    var w = opt.width || 5;

    // 两根柱子
    var pillarGeo = new THREE.CylinderGeometry(0.28, 0.34, h, 6);
    var p1 = mesh(pillarGeo, c);
    p1.position.set(-w / 2, h / 2, 0);
    var p2 = mesh(pillarGeo, c);
    p2.position.set(w / 2, h / 2, 0);
    g.add(p1, p2);

    // 柱子基座（石）
    var baseGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.5, 6);
    [-w / 2, w / 2].forEach(function (x) {
      var b = mesh(baseGeo, G.PALETTE.stone);
      b.position.set(x, 0.25, 0);
      g.add(b);
    });

    // 笠木（顶部横梁，两端上翘）
    var beamGeo = new THREE.BoxGeometry(w + 2.4, 0.42, 0.5);
    var beam = mesh(beamGeo, c);
    beam.position.set(0, h + 0.5, 0);
    g.add(beam);

    // 两端上翘（用旋转的小块伪造）
    [-1, 1].forEach(function (s) {
      var tip = mesh(new THREE.BoxGeometry(1.4, 0.36, 0.5), c);
      tip.position.set(s * (w / 2 + 1.3), h + 0.72, 0);
      tip.rotation.z = s * 0.28;
      g.add(tip);
    });

    // 岛木（第二道梁）
    var beam2 = mesh(new THREE.BoxGeometry(w + 0.6, 0.3, 0.36), c);
    beam2.position.set(0, h - 0.45, 0);
    g.add(beam2);

    // 额束（中间小竖块）
    var mid = mesh(new THREE.BoxGeometry(0.5, 0.9, 0.3), c);
    mid.position.set(0, h - 0.1, 0);
    g.add(mid);

    g.userData.height = h;
    return g;
  };

  // ---------- 纸灯（提灯） ----------
  W.lantern = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var poleH = opt.poleH || 2.6;
    var glow = opt.glow !== false;

    // 木杆
    var pole = mesh(new THREE.CylinderGeometry(0.09, 0.11, poleH, 5), G.PALETTE.woodDark);
    pole.position.y = poleH / 2;
    g.add(pole);

    // 横挑臂
    var arm = mesh(new THREE.BoxGeometry(0.7, 0.1, 0.1), G.PALETTE.woodDark);
    arm.position.set(0.3, poleH - 0.1, 0);
    g.add(arm);

    // 灯体（圆桶）
    var bodyMat = G.celMaterial(
      glow ? G.PALETTE.lampGlow : '#E8DCC0',
      { steps: 2, darkness: 0.9, emissive: glow ? G.PALETTE.lampGlow : '#000000',
        emissiveIntensity: glow ? 0.7 : 0 }
    );
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.7, 8), bodyMat);
    body.position.set(0.62, poleH - 0.62, 0);
    body.castShadow = true;
    g.add(body);

    // 灯顶/灯底（细木圈）
    [0.34, -0.34].forEach(function (dy) {
      var cap = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8), G.PALETTE.woodDark);
      cap.position.set(0.62, poleH - 0.62 + dy, 0);
      g.add(cap);
    });

    // 光晕（点光源，限制数量）
    if (glow && opt.light !== false) {
      var pl = new THREE.PointLight(0xFFD98A, 1.4, 7, 2);
      pl.position.set(0.62, poleH - 0.62, 0);
      g.add(pl);
      g.userData.light = pl;
    }
    return g;
  };

  // ---------- 樱花树 ----------
  W.sakura = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var scale = opt.scale || 1;
    var rnd = G.mulberry32(opt.seed || 12345);

    // 树干
    var trunkH = (2.6 + rnd() * 1.2) * scale;
    var trunk = mesh(
      new THREE.CylinderGeometry(0.16 * scale, 0.32 * scale, trunkH, 5),
      G.PALETTE.woodDark
    );
    trunk.position.y = trunkH / 2;
    g.add(trunk);

    // 分叉
    var branchCount = 3 + Math.floor(rnd() * 2);
    for (var i = 0; i < branchCount; i++) {
      var bl = (1.0 + rnd() * 0.7) * scale;
      var br = mesh(new THREE.CylinderGeometry(0.06 * scale, 0.12 * scale, bl, 4),
        G.PALETTE.woodDark);
      var a = (i / branchCount) * Math.PI * 2 + rnd() * 0.4;
      br.position.set(Math.cos(a) * 0.35 * scale, trunkH * 0.85, Math.sin(a) * 0.35 * scale);
      br.rotation.z = Math.cos(a) * 0.5;
      br.rotation.x = -Math.sin(a) * 0.5;
      g.add(br);
    }

    // 花冠：几个扁球堆叠
    var blossomColors = [G.PALETTE.sakura, '#FBE0E8', '#F2B8CC'];
    var clusters = 4 + Math.floor(rnd() * 3);
    for (var c = 0; c < clusters; c++) {
      var cr = (0.7 + rnd() * 0.55) * scale;
      var bloom = mesh(
        new THREE.IcosahedronGeometry(cr, 0),
        blossomColors[c % blossomColors.length],
        { steps: 2, darkness: 0.68 }
      );
      var ang = rnd() * Math.PI * 2;
      var rad = (0.3 + rnd() * 0.85) * scale;
      bloom.position.set(
        Math.cos(ang) * rad,
        trunkH + 0.15 * scale + (rnd() - 0.3) * 0.9 * scale,
        Math.sin(ang) * rad
      );
      bloom.scale.y = 0.75;
      g.add(bloom);
    }

    g.userData.trunkH = trunkH;
    return g;
  };

  // ---------- 木屋 ----------
  W.house = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var w = opt.w || 5, d = opt.d || 4.5, h = opt.h || 2.4;

    // 墙
    var walls = mesh(new THREE.BoxGeometry(w, h, d), opt.wall || G.PALETTE.cream);
    walls.position.y = h / 2;
    g.add(walls);

    // 木骨架（露柱）
    var postGeo = new THREE.BoxGeometry(0.18, h, 0.18);
    [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].forEach(function (p) {
      var post = mesh(postGeo, G.PALETTE.woodDark);
      post.position.set(p[0] * 0.98, h / 2, p[1] * 0.98);
      g.add(post);
    });

    // 屋顶（两坡，用两块斜板）
    var roofH = h + 1.3;
    var pitch = 0.42;
    var slopeLen = Math.sqrt(Math.pow(d / 2 + 0.6, 2) + Math.pow(1.3, 2));
    [-1, 1].forEach(function (s) {
      var slab = mesh(new THREE.BoxGeometry(w + 0.9, 0.16, slopeLen), opt.roof || G.PALETTE.vermilionD);
      slab.position.set(0, h + 0.65, s * (d / 4 + 0.15));
      slab.rotation.x = s * pitch;
      g.add(slab);
    });
    // 屋脊
    var ridge = mesh(new THREE.BoxGeometry(w + 1.0, 0.2, 0.3), G.PALETTE.woodDark);
    ridge.position.set(0, h + 1.28, 0);
    g.add(ridge);

    // 门
    var door = mesh(new THREE.BoxGeometry(1.1, 1.7, 0.08), G.PALETTE.wood);
    door.position.set(0, 0.85, d / 2 + 0.02);
    g.add(door);
    // 暖帘
    var noren = mesh(new THREE.BoxGeometry(1.35, 0.55, 0.05), opt.noren || G.PALETTE.skyDeep);
    noren.position.set(0, 1.75, d / 2 + 0.06);
    g.add(noren);

    // 窗（发光）
    var winMat = G.celMaterial(G.PALETTE.lampGlow, {
      steps: 2, darkness: 0.85, emissive: G.PALETTE.lampGlow, emissiveIntensity: 0.35
    });
    [-w / 3, w / 3].forEach(function (wx) {
      var win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.06), winMat);
      win.position.set(wx, 1.35, d / 2 + 0.03);
      g.add(win);
    });

    return g;
  };

  // ---------- 竹林 ----------
  //
  // 踩过的坑（第一版很糟）：竹竿用 CylinderGeometry(r, r*1.15, h, 5) 深绿 5 面体，
  // 在阴影里渲染成近乎纯黑的细竖条，完全读不出"竹子"；叶子是零散的深色小片飘在
  // 半空像碎屑。整体像一堆黑线。
  //
  // 修法：
  //  - 竹竿加粗、降低明度差、用明快的竹绿（#A8C583 系）而不是深苔绿
  //  - 侧面数提到 6，保留方块感但不至于糊成黑条
  //  - 叶子成簇挂在竹梢（V 形两片一组），贴着竿而不是乱飘
  //  - 顶部加一圈"竹冠"矮球，给出绿色体量
  W.bamboo = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var rnd = G.mulberry32(opt.seed || 777);
    var count = opt.count || 7;
    var spread = opt.spread || 1.6;
    var stalks = [];

    // 竹绿的几档（都比原来的深苔绿亮）
    var stalkColors = ['#A8C583', '#93B472', '#B8D094'];
    var leafColors = ['#7FA85E', '#93B472', '#A8C583'];

    for (var i = 0; i < count; i++) {
      var h = 3.6 + rnd() * 3.0;
      // 半径 0.10 在 640x360 的等距远景里只有约 1.5 像素宽，
      // 加上 1px 描边直接被吃掉 -> 渲染成黑线。
      // 必须粗到 0.20~0.28（约 3~4 像素）才能读出体积。
      var r = 0.21 + rnd() * 0.08;
      var col = stalkColors[i % stalkColors.length];
      var a = rnd() * Math.PI * 2;
      var rad = rnd() * spread;
      var px = Math.cos(a) * rad;
      var pz = Math.sin(a) * rad;

      // 竹竿：6 面，略带锥度
      var stalk = mesh(new THREE.CylinderGeometry(r * 0.86, r, h, 6), col,
        { steps: 2, darkness: 0.86 });
      stalk.position.set(px, h / 2, pz);
      stalk.rotation.z = (rnd() - 0.5) * 0.09;
      stalk.rotation.x = (rnd() - 0.5) * 0.09;
      g.add(stalk);
      stalks.push({
        mesh: stalk,
        baseRotZ: stalk.rotation.z,
        baseRotX: stalk.rotation.x,
        phase: rnd() * 6.28
      });

      // 竹节：比竿略粗一圈的竹青色环（用亮色，不然又是黑圈）
      var nodes = 3 + Math.floor(rnd() * 2);
      for (var n = 1; n <= nodes; n++) {
        var ny = (h / (nodes + 1)) * n;
        var ring = mesh(
          new THREE.CylinderGeometry(r * 1.16, r * 1.16, 0.09, 6),
          '#C8DCA8', { steps: 2, darkness: 0.92 }
        );
        ring.position.set(px, ny, pz);
        g.add(ring);
      }

      // 竹叶：成簇挂在竹梢，V 形两片一组，贴着竿向外伸
      var leafClusters = 2 + Math.floor(rnd() * 2);
      for (var c = 0; c < leafClusters; c++) {
        var ca = rnd() * Math.PI * 2;
        var cy = h * (0.72 + rnd() * 0.26);
        var lc = leafColors[Math.floor(rnd() * leafColors.length)];

        for (var k = 0; k < 3; k++) {
          var leaf = mesh(
            new THREE.PlaneGeometry(0.85, 0.22),
            lc, { side: THREE.DoubleSide, steps: 2, darkness: 0.88 }
          );
          // 从竿上向外斜伸
          var ang = ca + (k - 1) * 0.45;
          leaf.position.set(
            px + Math.cos(ang) * 0.44,
            cy + (k - 1) * 0.12,
            pz + Math.sin(ang) * 0.44
          );
          // 让叶片大致水平、朝外
          leaf.rotation.y = -ang;
          leaf.rotation.z = 0.45 + (rnd() - 0.5) * 0.3;
          leaf.rotation.x = -0.35;
          g.add(leaf);
        }
      }

      // 竹冠：一个扁球给出绿色体量（不然顶上全是空线）
      var crown = mesh(
        new THREE.IcosahedronGeometry(0.62 + rnd() * 0.26, 0),
        '#93B472', { steps: 2, darkness: 0.84 }
      );
      crown.position.set(px, h + 0.1, pz);
      crown.scale.set(1, 0.62, 1);
      g.add(crown);
    }

    g.userData.stalks = stalks;
    return g;
  };

  // ---------- 石阶 ----------
  W.stoneStairs = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var steps = opt.steps || 4;
    var wide = opt.w || 2.4;
    var rise = opt.rise || 0.22;
    var run = opt.run || 0.5;
    for (var i = 0; i < steps; i++) {
      var s = mesh(new THREE.BoxGeometry(wide, rise * (i + 1), run), G.PALETTE.stone);
      s.position.set(0, rise * (i + 1) / 2, -i * run);
      g.add(s);
    }
    return g;
  };

  // ---------- 石头 / 岩石 ----------
  W.rock = function (opt) {
    opt = opt || {};
    var rnd = G.mulberry32(opt.seed || 42);
    var g = new THREE.Group();
    var base = mesh(
      new THREE.DodecahedronGeometry(opt.size || 0.7, 0),
      opt.color || G.PALETTE.stone
    );
    base.position.y = (opt.size || 0.7) * 0.55;
    base.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    base.scale.set(1, 0.8 + rnd() * 0.3, 1);
    g.add(base);
    if (rnd() > 0.5) {
      var small = mesh(new THREE.DodecahedronGeometry((opt.size || 0.7) * 0.5, 0),
        G.col.shade(opt.color || G.PALETTE.stone, -0.1));
      small.position.set((rnd() - 0.5) * 1.2, (opt.size || 0.7) * 0.25, (rnd() - 0.5) * 1.2);
      small.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      g.add(small);
    }
    return g;
  };

  // ---------- 草丛 / 灌木 ----------
  W.bush = function (opt) {
    opt = opt || {};
    var rnd = G.mulberry32(opt.seed || 99);
    var g = new THREE.Group();
    var n = 2 + Math.floor(rnd() * 2);
    for (var i = 0; i < n; i++) {
      var r = 0.28 + rnd() * 0.22;
      var b = mesh(new THREE.IcosahedronGeometry(r, 0),
        rnd() > 0.5 ? G.PALETTE.grass : G.PALETTE.grassDim,
        { steps: 2, darkness: 0.65 });
      b.position.set((rnd() - 0.5) * 0.6, r * 0.7, (rnd() - 0.5) * 0.6);
      b.scale.y = 0.8;
      g.add(b);
    }
    return g;
  };

  // ---------- 篱笆 ----------
  W.fence = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var len = opt.len || 4;
    var segs = Math.max(2, Math.round(len / 0.8));
    for (var i = 0; i <= segs; i++) {
      var post = mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.0, 4), G.PALETTE.woodDark);
      post.position.set(-len / 2 + (len / segs) * i, 0.5, 0);
      g.add(post);
    }
    var rail = mesh(new THREE.BoxGeometry(len, 0.1, 0.08), G.PALETTE.wood);
    rail.position.y = 0.72;
    g.add(rail);
    var rail2 = rail.clone();
    rail2.position.y = 0.38;
    g.add(rail2);
    return g;
  };

  // ---------- 水（溪谷） ----------
  W.water = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var w = opt.w || 5, d = opt.d || 20;
    var matW = new THREE.MeshToonMaterial({
      color: new THREE.Color(G.PALETTE.water),
      gradientMap: G.gradientMap(2, 0.75),
      transparent: true,
      opacity: 0.82
    });
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d, 1, 1), matW);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = opt.y || -0.12;
    plane.receiveShadow = true;
    g.add(plane);
    g.userData.material = matW;
    // 波光：细微上下浮动由 update 驱动
    g.userData.baseY = plane.position.y;
    return g;
  };

  // ---------- 碑文（可交互） ----------
  W.stele = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var base = mesh(new THREE.BoxGeometry(0.9, 0.25, 0.6), G.PALETTE.stoneDark);
    base.position.y = 0.12;
    g.add(base);
    var body = mesh(new THREE.BoxGeometry(0.68, 1.5, 0.22), G.PALETTE.stone);
    body.position.y = 1.0;
    g.add(body);
    // 顶部斜切（用旋转薄片伪造）
    var top = mesh(new THREE.BoxGeometry(0.7, 0.2, 0.24), G.PALETTE.stoneDark);
    top.position.y = 1.78;
    top.rotation.x = 0.15;
    g.add(top);
    // 刻字（几道横纹）
    for (var i = 0; i < 4; i++) {
      var line = mesh(new THREE.BoxGeometry(0.34, 0.045, 0.02), G.PALETTE.inkSoft);
      line.position.set(0, 1.35 - i * 0.16, 0.13);
      g.add(line);
    }
    return g;
  };

  // ---------- 结晶（结：视觉锚点） ----------
  W.knot = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var color = opt.color || G.PALETTE.sakura;
    var coreMat = G.celMaterial(color, {
      steps: 2, darkness: 0.8, emissive: color, emissiveIntensity: 0.9
    });
    var core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), coreMat);
    core.position.y = 1.3;
    g.add(core);
    g.userData.core = core;
    g.userData.coreMat = coreMat;

    // 外环（缓慢旋转）
    var ringMat = G.celMaterial(color, {
      steps: 2, darkness: 0.9, emissive: color, emissiveIntensity: 0.5,
      transparent: true, opacity: 0.55
    });
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.045, 4, 16), ringMat);
    ring.position.y = 1.3;
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.userData.ring = ring;

    // 光柱（半透明圆柱）
    var beamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 3.2, 8, 1, true), beamMat);
    beam.position.y = 1.6;
    g.add(beam);

    // 点光
    var pl = new THREE.PointLight(new THREE.Color(color), 0.9, 5, 2);
    pl.position.y = 1.3;
    g.add(pl);
    return g;
  };

  // ---------- 宝箱 ----------
  W.chest = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var box = mesh(new THREE.BoxGeometry(0.8, 0.5, 0.55), G.PALETTE.wood);
    box.position.y = 0.25;
    g.add(box);
    var lid = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 6, 1, false, 0, Math.PI),
      G.PALETTE.woodDark);
    lid.rotation.z = Math.PI / 2;
    lid.position.y = 0.5;
    g.add(lid);
    // 金属包边
    var band = mesh(new THREE.BoxGeometry(0.82, 0.08, 0.57), G.PALETTE.gold);
    band.position.y = 0.34;
    g.add(band);
    var lock = mesh(new THREE.BoxGeometry(0.14, 0.16, 0.08), G.PALETTE.gold);
    lock.position.set(0, 0.4, 0.3);
    g.add(lock);
    g.userData.lid = lid;
    return g;
  };

  // ---------- 罐子（可破坏） ----------
  W.pot = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var body = mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.62, 6), opt.color || '#C89A78');
    body.position.y = 0.31;
    g.add(body);
    var neck = mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.14, 6), opt.color || '#B08868');
    neck.position.y = 0.66;
    g.add(neck);
    return g;
  };

  // ---------- 采集节点（矿/草药） ----------
  W.resourceNode = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var type = opt.type || 'herb';
    if (type === 'herb') {
      // 草药：几片叶子 + 小花
      for (var i = 0; i < 5; i++) {
        var a = (i / 5) * Math.PI * 2;
        var leaf = mesh(new THREE.PlaneGeometry(0.5, 0.16), G.PALETTE.moss,
          { side: THREE.DoubleSide });
        leaf.position.set(Math.cos(a) * 0.18, 0.18 + Math.random() * 0.06, Math.sin(a) * 0.18);
        leaf.rotation.set(-Math.PI / 2 + 0.5, a, 0);
        g.add(leaf);
      }
      var flower = mesh(new THREE.IcosahedronGeometry(0.14, 0), opt.color || '#E8A0B8',
        { steps: 2, darkness: 0.7 });
      flower.position.y = 0.42;
      g.add(flower);
    } else if (type === 'ore') {
      // 矿石：几块带金属感的石头
      for (var j = 0; j < 3; j++) {
        var rock = mesh(new THREE.DodecahedronGeometry(0.22 + j * 0.06, 0),
          j === 0 ? (opt.color || '#9AB0C0') : G.PALETTE.stone);
        rock.position.set((Math.random() - 0.5) * 0.4, 0.14 + j * 0.1, (Math.random() - 0.5) * 0.4);
        rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        g.add(rock);
      }
    }
    return g;
  };

  // ---------- 土路 ----------
  // 必须逐顶点贴合地形，否则在坡坎上会悬空或插进土里。
  // 用细分平面（默认 8x8 段足够）并按 height(x,z) 抬顶点。
  W.path = function (opt) {
    opt = opt || {};
    var w = opt.w || 4;
    var d = opt.d || 10;
    var segX = Math.max(2, Math.round(w / 0.6));
    var segZ = Math.max(2, Math.round(d / 0.6));

    var geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      // 局部坐标 -> 世界坐标（group 会被放到 opt.x/opt.z）
      var lx = pos.getX(i);
      var lz = pos.getZ(i);
      var wx = lx + (opt.x || 0);
      var wz = lz + (opt.z || 0);
      pos.setY(i, G.terrain.height(wx, wz) + (opt.y || 0));
    }
    geo.computeVertexNormals();

    var tex = G.art.grassTexture({
      base: '#C9A87C',
      repeat: Math.max(2, Math.round(d / 4)),
      seed: (opt.seed || 3) + Math.round(opt.z || 0)
    });

    var mat = G.celMaterial('#FFFFFF', {
      steps: 2,
      darkness: 0.82,
      map: tex
    });
    // 修正 UV：默认 UV 是 0..1，贴图靠 texture.repeat 铺
    tex.repeat.set(1, 1);

    var m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.position.y = opt.y || 0;
    return m;
  };

  // ---------- 远景地标：五重塔 ----------
  // 目的：给野外一个"远看就知道往哪走"的视觉锚点。
  // 等距俯视下高塔的剪影最能打破地平线的单调。
  W.pagoda = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var tiers = opt.tiers || 5;
    var baseW = opt.baseW || 5.0;
    var bodyColor = opt.color || G.PALETTE.vermilionD;
    var roofColor = opt.roof || '#8A3A32';

    // 石基座
    var plinth = mesh(new THREE.BoxGeometry(baseW + 2.2, 0.7, baseW + 2.2), G.PALETTE.stone);
    plinth.position.y = 0.35;
    g.add(plinth);
    var plinth2 = mesh(new THREE.BoxGeometry(baseW + 1.2, 0.5, baseW + 1.2), G.PALETTE.stoneDark);
    plinth2.position.y = 0.95;
    g.add(plinth2);

    var y = 1.2;
    for (var i = 0; i < tiers; i++) {
      var t = i / Math.max(1, tiers - 1);
      var w = baseW * (1 - t * 0.52);
      var h = 1.5 * (1 - t * 0.22);

      var body = mesh(new THREE.BoxGeometry(w, h, w), bodyColor,
        { steps: 2, darkness: 0.88 });
      body.position.y = y + h / 2;
      g.add(body);

      // 屋檐（两块交叉薄板伪造四坡）
      // 檐宽不能太夸张：初版 eaveW = w + 1.5，导致视觉上几乎只看见檐、
      // 看不见塔身，整座塔读起来是一片暗红。收到 w + 0.9。
      var eaveW = w + 0.9;
      for (var k = 0; k < 2; k++) {
        var eave = mesh(new THREE.BoxGeometry(eaveW, 0.2, eaveW * 0.58),
          roofColor, { steps: 2, darkness: 0.9 });
        eave.position.y = y + h + 0.1;
        eave.rotation.y = k * Math.PI / 2;
        g.add(eave);
      }
      // 檐角翘起（小块，别喧宾夺主）
      for (var s = 0; s < 4; s++) {
        var a = s * Math.PI / 2 + Math.PI / 4;
        var tip = mesh(new THREE.BoxGeometry(0.6, 0.16, 0.6), roofColor,
          { steps: 2, darkness: 0.9 });
        tip.position.set(
          Math.cos(a) * eaveW * 0.4,
          y + h + 0.22,
          Math.sin(a) * eaveW * 0.4
        );
        tip.rotation.y = a;
        g.add(tip);
      }

      // 窗（发光）
      if (i < tiers - 1) {
        var winMat = G.celMaterial(G.PALETTE.lampGlow, {
          steps: 2, darkness: 0.92,
          emissive: G.PALETTE.lampGlow, emissiveIntensity: 0.4
        });
        var win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.34, h * 0.42, 0.1), winMat);
        win.position.set(0, y + h * 0.5, w / 2 + 0.04);
        g.add(win);
      }

      y += h + 1.0;
    }

    // 相轮（顶端尖塔）
    var spire = mesh(new THREE.CylinderGeometry(0.14, 0.2, 3.2, 6), '#6B8A5A');
    spire.position.y = y + 1.4;
    g.add(spire);
    for (var r = 0; r < 4; r++) {
      var ring = mesh(new THREE.TorusGeometry(0.42 - r * 0.06, 0.07, 4, 10),
        G.PALETTE.gold, { steps: 2, darkness: 0.85 });
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y + 0.5 + r * 0.55;
      g.add(ring);
    }

    g.userData.height = y;
    return g;
  };

  // ---------- 石灯笼（地标点缀） ----------
  W.stoneLantern = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var s = opt.scale || 1;
    var base = mesh(new THREE.CylinderGeometry(0.42 * s, 0.5 * s, 0.3 * s, 6), G.PALETTE.stone);
    base.position.y = 0.15 * s;
    g.add(base);
    var post = mesh(new THREE.CylinderGeometry(0.16 * s, 0.2 * s, 1.1 * s, 6), G.PALETTE.stone);
    post.position.y = 0.85 * s;
    g.add(post);
    var box = new THREE.Mesh(
      new THREE.BoxGeometry(0.55 * s, 0.45 * s, 0.55 * s),
      G.celMaterial(G.PALETTE.lampGlow, {
        steps: 2, darkness: 0.94,
        emissive: G.PALETTE.lampGlow, emissiveIntensity: 0.75
      })
    );
    box.position.y = 1.62 * s;
    g.add(box);
    var roof = mesh(new THREE.ConeGeometry(0.55 * s, 0.38 * s, 4), G.PALETTE.stoneDark);
    roof.position.y = 2.02 * s;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    var pl = new THREE.PointLight(0xFFE0A0, 0.8, 5, 2);
    pl.position.y = 1.62 * s;
    g.add(pl);
    g.userData.light = pl;
    return g;
  };

  // ---------- 草丛（贴地小物件，增加密度感） ----------
  W.grassTuft = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var col = opt.color || '#8AA96A';
    var h = 0.3 + ((opt.seed || 0) % 7) / 22;
    for (var i = 0; i < 3; i++) {
      var blade = mesh(
        new THREE.PlaneGeometry(0.11, h),
        col,
        { side: THREE.DoubleSide, steps: 2, darkness: 0.9 }
      );
      var a = (i / 3) * Math.PI + (opt.seed || 0) * 0.3;
      blade.position.set(Math.cos(a) * 0.07, h / 2, Math.sin(a) * 0.07);
      blade.rotation.y = a;
      blade.rotation.z = (i - 1) * 0.18;
      g.add(blade);
    }
    return g;
  };

  // ---------- 野花 ----------
  W.flower = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var col = opt.color || '#F7C8D8';
    var stem = mesh(new THREE.PlaneGeometry(0.05, 0.3), '#7FA85E',
      { side: THREE.DoubleSide });
    stem.position.y = 0.15;
    g.add(stem);
    var head = mesh(new THREE.IcosahedronGeometry(0.11, 0), col,
      { steps: 2, darkness: 0.88 });
    head.position.y = 0.34;
    g.add(head);
    return g;
  };

  // ---------- 传送点 / 神社 ----------
  W.shrine = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    // 基座
    var base = mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.3, 8), G.PALETTE.stone);
    base.position.y = 0.15;
    g.add(base);
    var base2 = mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.25, 8), G.PALETTE.stoneDark);
    base2.position.y = 0.42;
    g.add(base2);
    // 石灯笼
    var post = mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.2, 6), G.PALETTE.stone);
    post.position.y = 1.15;
    g.add(post);
    var box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6),
      G.celMaterial(G.PALETTE.lampGlow, { steps: 2, darkness: 0.9, emissive: G.PALETTE.lampGlow, emissiveIntensity: 0.8 }));
    box.position.y = 1.9;
    g.add(box);
    var roof = mesh(new THREE.ConeGeometry(0.62, 0.4, 4), G.PALETTE.stoneDark);
    roof.position.y = 2.28;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    var pl = new THREE.PointLight(0xFFE0A0, 1.2, 6, 2);
    pl.position.y = 1.9;
    g.add(pl);
    return g;
  };

  // ---------- 地面贴图（程序化草地） ----------
  W.grassTexture = function (opt) {
    opt = opt || {};
    var size = 64;
    var c = G.makeCanvas(size, size);
    var ctx = c.getContext('2d');
    var rnd = G.mulberry32(opt.seed || 5);
    // 底色
    ctx.fillStyle = opt.base || G.PALETTE.grass;
    ctx.fillRect(0, 0, size, size);
    // 深浅斑点
    for (var i = 0; i < 260; i++) {
      var x = Math.floor(rnd() * size);
      var y = Math.floor(rnd() * size);
      var v = rnd();
      ctx.fillStyle = v > 0.62
        ? G.col.shade(opt.base || G.PALETTE.grass, -0.14)
        : (v > 0.34 ? G.col.shade(opt.base || G.PALETTE.grass, 0.1)
                    : G.col.shade(opt.base || G.PALETTE.grass, 0.04));
      ctx.fillRect(x, y, rnd() > 0.8 ? 2 : 1, 1);
    }
    // 几撮草
    for (var g2 = 0; g2 < 26; g2++) {
      var gx = Math.floor(rnd() * size), gy = Math.floor(rnd() * size);
      ctx.fillStyle = G.col.shade(opt.base || G.PALETTE.grass, -0.22);
      ctx.fillRect(gx, gy, 1, 2);
      ctx.fillRect(gx + 1, gy + 1, 1, 1);
    }
    var tex = G.canvasTexture(c, true);
    tex.repeat.set(opt.repeat || 8, opt.repeat || 8);
    return tex;
  };

  /** 地面贴图的材质（Toon + 草地纹理）
   *
   * 踩过的坑：贴图本身已经画成了 base 色，材质 color 又设成同一个 base，
   * 结果 map × color 双重相乘 -> 草地变成暗橄榄绿、土路变成深棕。
   * 正确做法：材质 color 用白色（让贴图颜色原样透过）。
   */
  W.groundMaterial = function (colorHex, opt) {
    opt = opt || {};
    var tex = W.grassTexture({ base: colorHex, repeat: opt.repeat || 6, seed: opt.seed || 5 });
    return G.celMaterial('#FFFFFF', {
      steps: 2,
      darkness: 0.76,
      map: tex
    });
  };

})(window.G = window.G || {});
