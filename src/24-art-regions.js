/* 24-art-regions.js — 新地区专属美术素材
 *
 * 神山 / 码头小镇 / 沙滩 需要现有 art 里没有的物件：
 *   - 海与浪（比现有 water 大得多，需要动态）
 *   - 船与栈桥（码头的识别特征）
 *   - 礁石与海草（沙滩）
 *   - 山石与云雾（神山）
 *   - 渔具、木箱、旗帜（码头生活感）
 *
 * 全部沿用 21-art-world.js 的约定：程序化几何 + 顶点色 + 按材质合并。
 */
(function (G) {
  'use strict';

  var W = G.art = G.art || {};

  // ---------- 材质缓存（本文件独立，避免和 21-art-world 的缓存互相干扰） ----------
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
  function tmesh(geo, color, texKind, opt) {
    opt = opt || {};
    var key = 'tex|' + color + '|' + texKind + '|' + (opt.repeat || 1);
    if (!matCache[key]) {
      var tex = G.texCached(texKind, color, { seed: opt.seed });
      if (tex) {
        tex = tex.clone();
        tex.needsUpdate = true;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(opt.repeat || 1, opt.repeat || 1);
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
      }
      matCache[key] = G.celMaterial(tex ? '#FFFFFF' : color, {
        steps: opt.steps != null ? opt.steps : 3,
        darkness: opt.darkness != null ? opt.darkness : 0.86,
        map: tex || undefined,
        side: opt.side
      });
    }
    var m = new THREE.Mesh(geo, matCache[key]);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // =====================================================================
  // 海（大水面 + 波纹动画）
  // =====================================================================
  W.sea = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var w = opt.w || 200;
    var d = opt.d || 200;

    // 细分平面：用低段数 + sin 位移做波纹（比 shader 便宜且可控）
    var segX = 40, segZ = 40;
    var geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    var material = new THREE.MeshToonMaterial({
      color: new THREE.Color(opt.color || '#7FB8C8'),
      gradientMap: G.gradientMap(3, 0.62),
      transparent: true,
      opacity: opt.opacity != null ? opt.opacity : 0.88
    });

    var plane = new THREE.Mesh(geo, material);
    plane.position.y = opt.y != null ? opt.y : G.terrain.seaLevel() - 0.15;
    plane.receiveShadow = true;
    g.add(plane);

    // 记录原始顶点，供动画位移
    var pos = geo.attributes.position;
    var baseY = new Float32Array(pos.count);
    for (var i = 0; i < pos.count; i++) baseY[i] = pos.getY(i);

    g.userData.wave = {
      mesh: plane, geo: geo, baseY: baseY,
      segX: segX, segZ: segZ,
      w: w, d: d,
      phase: Math.random() * 6.28
    };
    return g;
  };

  // =====================================================================
  // 沙滩（沙地平面，带潮间带渐变）
  // =====================================================================
  W.beachSand = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var w = opt.w || 80, d = opt.d || 100;
    var segX = 32, segZ = 40;

    var geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    var cx = opt.x || 0, cz = opt.z || 0;
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);

    // 湿沙（靠海）暗、干沙（内陆）亮
    var dry = new THREE.Color(opt.dry || '#E8D8B0');
    var wet = new THREE.Color(opt.wet || '#C8B088');

    for (var i = 0; i < pos.count; i++) {
      var wx = pos.getX(i) + cx;
      var wz = pos.getZ(i) + cz;
      pos.setY(i, G.terrain.height(wx, wz) + 0.03);

      // 靠海（x 大）越湿
      var t = G.M.clamp01((wx - (cx - w / 2)) / w);
      var c = dry.clone().lerp(wet, t * t);
      // 加一点颗粒抖动
      var jitter = (Math.sin(wx * 2.1) * Math.cos(wz * 1.7)) * 0.04;
      colors[i * 3] = G.M.clamp01(c.r + jitter);
      colors[i * 3 + 1] = G.M.clamp01(c.g + jitter);
      colors[i * 3 + 2] = G.M.clamp01(c.b + jitter);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    var m = new THREE.Mesh(geo, G.celMaterial('#FFFFFF', {
      steps: 3, darkness: 0.86,
      map: G.art.grassTexture({ base: '#E8D8B0', repeat: 12, seed: 77 }),
      vertexColors: true
    }));
    m.receiveShadow = true;
    g.add(m);
    return g;
  };

  // =====================================================================
  // 礁石（海边岩块群）
  // =====================================================================
  W.reef = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var rnd = G.mulberry32(opt.seed || 500);
    var n = 3 + Math.floor(rnd() * 3);
    for (var i = 0; i < n; i++) {
      var r = 0.4 + rnd() * 0.8;
      var rock = mesh(new THREE.DodecahedronGeometry(r, 0),
        opt.color || '#8A8578', { steps: 3, darkness: 0.84 });
      rock.position.set((rnd() - 0.5) * 2.2, r * 0.5, (rnd() - 0.5) * 2.2);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.scale.y = 0.7 + rnd() * 0.4;
      g.add(rock);
    }
    // 海草
    if (opt.kelp !== false) {
      for (var k = 0; k < 3; k++) {
        var kelp = mesh(new THREE.PlaneGeometry(0.18, 1.2),
          '#5A8A5A', { side: THREE.DoubleSide, steps: 3, darkness: 0.88 });
        kelp.position.set((rnd() - 0.5) * 2, 0.6, (rnd() - 0.5) * 2);
        kelp.rotation.y = rnd() * 3;
        g.add(kelp);
      }
    }
    return g;
  };

  // =====================================================================
  // 栈桥（码头核心物件）
  // =====================================================================
  W.pier = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var len = opt.len || 14;
    var wide = opt.w || 3.2;
    var deckY = opt.deckY != null ? opt.deckY : 1.4;

    // 桥面：木板一条条铺
    var plankCount = Math.round(len / 0.7);
    for (var i = 0; i < plankCount; i++) {
      var plank = tmesh(
        new THREE.BoxGeometry(wide, 0.12, 0.62),
        '#9C7C55', 'wood', { repeat: 1, seed: 600 + i }
      );
      plank.position.set(0, deckY, -len / 2 + i * (len / plankCount) + 0.35);
      g.add(plank);
    }

    // 桥桩（每 3 单位一根，左右各一）
    var postCount = Math.max(2, Math.round(len / 3));
    for (var p = 0; p <= postCount; p++) {
      var pz = -len / 2 + (len / postCount) * p;
      [-1, 1].forEach(function (side) {
        var post = tmesh(
          new THREE.CylinderGeometry(0.13, 0.16, deckY + 1.6, 6),
          '#7A5540', 'wood', { repeat: 1, seed: 620 }
        );
        post.position.set(side * (wide / 2 - 0.2), (deckY - 1.6) / 2 + 0.1, pz);
        g.add(post);
      });
    }

    // 护栏
    [-1, 1].forEach(function (side) {
      var rail = mesh(new THREE.BoxGeometry(0.1, 0.1, len), '#7A5540');
      rail.position.set(side * (wide / 2 - 0.2), deckY + 0.7, 0);
      g.add(rail);
      // 栏杆立柱
      for (var r = 0; r <= postCount; r++) {
        var rz = -len / 2 + (len / postCount) * r;
        var rp = mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), '#7A5540');
        rp.position.set(side * (wide / 2 - 0.2), deckY + 0.35, rz);
        g.add(rp);
      }
    });

    g.userData.deckY = deckY;
    W.flattenGroupByMaterial(g);
    return g;
  };

  // =====================================================================
  // 渔船（和风小舟）
  // =====================================================================
  W.boat = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var len = opt.len || 4.2;
    var wide = opt.w || 1.5;
    var hullColor = opt.color || '#8A6A4A';

    // 船身：用圆柱压扁 + 两端收窄伪造
    var hull = tmesh(
      new THREE.CylinderGeometry(wide / 2, wide / 2 * 0.7, len, 8, 1, false),
      hullColor, 'wood', { repeat: 2, seed: 640 }
    );
    hull.rotation.z = Math.PI / 2;
    hull.rotation.y = Math.PI / 2;
    hull.scale.y = 0.55;
    hull.position.y = 0.35;
    g.add(hull);

    // 船舷（一圈深色边）
    var rim = mesh(new THREE.TorusGeometry(len / 2 * 0.92, 0.08, 4, 14), '#6A4A32');
    rim.rotation.x = Math.PI / 2;
    rim.rotation.z = Math.PI / 2;
    rim.scale.set(1, wide / len, 1);
    rim.position.y = 0.62;
    g.add(rim);

    // 船尾小桨架
    var oar = mesh(new THREE.CylinderGeometry(0.05, 0.05, len * 0.7, 4), '#7A5540');
    oar.rotation.z = Math.PI / 2.4;
    oar.position.set(0, 0.75, len * 0.15);
    g.add(oar);

    // 船头灯（夜间可见）
    var lampMat = G.celMaterial('#FFE9A8', {
      steps: 2, darkness: 0.95, emissive: '#FFE9A8', emissiveIntensity: 0.7
    });
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), lampMat);
    lamp.position.set(0, 1.05, -len / 2 + 0.4);
    g.add(lamp);

    W.flattenGroupByMaterial(g);
    return g;
  };

  // =====================================================================
  // 渔具 / 木箱 / 木桶（码头生活感）
  // =====================================================================
  W.crate = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var s = opt.size || 0.7;
    var box = tmesh(new THREE.BoxGeometry(s, s, s), '#A8845C', 'wood',
      { repeat: 1, seed: opt.seed || 700 });
    box.position.y = s / 2;
    g.add(box);
    // 捆扎带
    [-1, 1].forEach(function (side) {
      var band = mesh(new THREE.BoxGeometry(s * 1.02, 0.06, s * 1.02), '#6A4A32');
      band.position.y = s / 2 + side * s * 0.25;
      g.add(band);
    });
    W.flattenGroupByMaterial(g);
    return g;
  };

  W.barrel = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var r = opt.r || 0.35;
    var h = opt.h || 0.8;
    var body = tmesh(new THREE.CylinderGeometry(r, r * 0.88, h, 8), '#A8845C', 'wood',
      { repeat: 1, seed: opt.seed || 710 });
    body.position.y = h / 2;
    g.add(body);
    // 两道铁箍
    [0.28, 0.72].forEach(function (t) {
      var hoop = mesh(new THREE.TorusGeometry(r * 1.02, 0.035, 4, 10), '#5B4A44');
      hoop.rotation.x = Math.PI / 2;
      hoop.position.y = h * t;
      g.add(hoop);
    });
    W.flattenGroupByMaterial(g);
    return g;
  };

  /** 晾晒的渔网（几片横向网面） */
  W.fishingNet = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var w = opt.w || 3;
    var h = opt.h || 1.6;
    // 两根竹竿
    [-1, 1].forEach(function (side) {
      var pole = mesh(new THREE.CylinderGeometry(0.07, 0.09, h + 0.4, 5), '#A8C583');
      pole.position.set(side * w / 2, (h + 0.4) / 2, 0);
      g.add(pole);
    });
    // 网面（半透明）
    var netMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#C8D0C0'),
      transparent: true, opacity: 0.42,
      side: THREE.DoubleSide, depthWrite: false
    });
    var net = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 4, 3), netMat);
    net.position.y = h / 2 + 0.2;
    g.add(net);
    // 网上的浮子
    for (var i = 0; i < 5; i++) {
      var float = mesh(new THREE.SphereGeometry(0.06, 4, 3), '#D9483B');
      float.position.set(-w / 2 + (i + 0.5) * (w / 5), h * 0.8, 0.02);
      g.add(float);
    }
    return g;
  };

  // =====================================================================
  // 山石（神山：比普通 rock 更大更陡）
  // =====================================================================
  W.mountainRock = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var rnd = G.mulberry32(opt.seed || 800);
    var size = opt.size || 2.2;
    var color = opt.color || '#9A9588';

    // 主岩体：多个方块堆叠，形成嶙峋感
    var layers = 2 + Math.floor(rnd() * 2);
    for (var i = 0; i < layers; i++) {
      var s = size * (1 - i * 0.22);
      var block = mesh(
        new THREE.BoxGeometry(s, s * 0.75, s * 0.85),
        color, { steps: 3, darkness: 0.8 }
      );
      block.position.set(
        (rnd() - 0.5) * size * 0.4,
        size * 0.36 + i * size * 0.42,
        (rnd() - 0.5) * size * 0.4
      );
      block.rotation.set((rnd() - 0.5) * 0.3, rnd() * 3, (rnd() - 0.5) * 0.3);
      g.add(block);
    }
    // 顶部尖石
    var peak = mesh(new THREE.ConeGeometry(size * 0.32, size * 0.7, 4), color,
      { steps: 3, darkness: 0.78 });
    peak.position.y = size * 0.36 + layers * size * 0.42;
    peak.rotation.y = rnd() * 3;
    g.add(peak);

    W.flattenGroupByMaterial(g);
    return g;
  };

  /** 山道石阶（比现有 stoneStairs 更长，用于登山） */
  W.mountainStairs = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var steps = opt.steps || 8;
    var wide = opt.w || 3;
    var rise = opt.rise || 0.24;
    var run = opt.run || 0.55;
    for (var i = 0; i < steps; i++) {
      var s = tmesh(
        new THREE.BoxGeometry(wide, rise * (i + 1), run),
        '#B8B2A4', 'stoneBrick', { repeat: 1, seed: 820 }
      );
      s.position.set(0, rise * (i + 1) / 2, -i * run);
      g.add(s);
    }
    W.flattenGroupByMaterial(g);
    return g;
  };

  /** 云雾（半透明球体，漂浮在山腰） */
  W.mist = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var rnd = G.mulberry32(opt.seed || 900);
    var count = opt.count || 5;
    var mistMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(opt.color || '#E8F0F4'),
      transparent: true,
      opacity: opt.opacity != null ? opt.opacity : 0.28,
      depthWrite: false
    });
    for (var i = 0; i < count; i++) {
      var r = (1.6 + rnd() * 2.4) * (opt.scale || 1);
      var puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mistMat);
      puff.position.set(
        (rnd() - 0.5) * (opt.spread || 8),
        (rnd()) * 3,
        (rnd() - 0.5) * (opt.spread || 8)
      );
      puff.scale.y = 0.4;
      g.add(puff);
    }
    g.userData.isMist = true;
    g.userData.mistMat = mistMat;
    return g;
  };

  // =====================================================================
  // 码头旗帜（布幡）
  // =====================================================================
  W.banner = function (opt) {
    opt = opt || {};
    var g = new THREE.Group();
    var h = opt.h || 3.2;
    var pole = mesh(new THREE.CylinderGeometry(0.06, 0.08, h, 5), '#7A5540');
    pole.position.y = h / 2;
    g.add(pole);

    var clothColor = opt.color || '#D9483B';
    var cloth = mesh(new THREE.PlaneGeometry(0.9, 1.8), clothColor,
      { side: THREE.DoubleSide, steps: 3, darkness: 0.9 });
    cloth.position.set(0.5, h - 1.1, 0);
    g.add(cloth);
    // 布上的横纹
    for (var i = 0; i < 3; i++) {
      var stripe = mesh(new THREE.PlaneGeometry(0.9, 0.1), '#FBF3E4',
        { side: THREE.DoubleSide });
      stripe.position.set(0.5, h - 0.5 - i * 0.5, 0.01);
      g.add(stripe);
    }
    return g;
  };

})(window.G = window.G || {});
