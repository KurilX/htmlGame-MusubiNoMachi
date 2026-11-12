/* 50-world.js — 世界构建与运行时
 *
 * 职责：把 data/zones.js 的声明式数据变成真实的 three.js 场景。
 * 所有"世界变更"都走 dispatch(intent)（见 90-arch.js），这里只负责构建与查询。
 */
(function (G) {
  'use strict';

  var M = G.M;

  var W = G.world = {
    scene: null,
    sun: null,
    ambient: null,
    ground: null,
    props: [],
    colliders: [],
    interactables: [],
    npcs: [],
    enemies: [],
    spawnZones: [],
    timeOfDay: 0.32,          // 0..1，0.32 = 早晨
    dayLengthSec: 20 * 60,    // 20 分钟一天
    dayCount: 0,
    inDungeon: false,
    dungeonRoom: 0,
    ambientShaderTime: 0
  };

  // =====================================================================
  // 昼夜判定（必须在 build 之前定义：buildNPCs 里会调用 isNight）
  // =====================================================================
  // timeOfDay: 0 = 午夜, 0.25 = 6:00 日出, 0.5 = 正午, 0.75 = 18:00 日落
  var DAWN = 0.24, DUSK = 0.76;
  var TRANS = 0.07;

  W.isNight = function () {
    var t = W.timeOfDay;
    return t < DAWN || t > DUSK;
  };

  /**
   * 夜色程度 0..1。0 = 正午全亮，1 = 深夜。
   * 踩过的坑：最初写反过，导致 07:41 显示月亮图标、白天画面像黄昏。
   */
  W.nightFactor = function () {
    var t = W.timeOfDay;
    if (t < DAWN - TRANS) return 1;                       // 深夜
    if (t < DAWN) return (DAWN - t) / TRANS;              // 黎明前
    if (t < DAWN + TRANS) return 1 - (t - DAWN) / TRANS;  // 日出
    if (t < DUSK - TRANS) return 0;                       // 白天
    if (t < DUSK) return (t - (DUSK - TRANS)) / TRANS;    // 入夜
    if (t < DUSK + TRANS) return 0.5 + ((t - DUSK) / TRANS) * 0.5;
    return 1;
  };

  /** 黄昏/黎明程度（用于染色）0..1 */
  W.duskFactor = function () {
    var t = W.timeOfDay;
    var a = 0;
    if (t > DAWN - TRANS && t < DAWN + TRANS) {
      a = 1 - Math.abs(t - DAWN) / TRANS;
    }
    if (t > DUSK - TRANS && t < DUSK + TRANS) {
      a = Math.max(a, 1 - Math.abs(t - DUSK) / TRANS);
    }
    return G.M.clamp01(a);
  };

  // =====================================================================
  // 构建
  // =====================================================================
  W.build = function () {
    var scene = new THREE.Scene();
    W.scene = scene;
    // 天空色（按时间）
    scene.background = new THREE.Color(G.PALETTE.sky);
    // 雾：起点必须远大于相机到玩家的距离（相机距离 34），
    // 否则整个画面糊成一片（踩过：near=34 时全屏发灰）
    //
    // 【2026-11 世界扩建后必须拉远】
    // 原来 near=62 far=105。世界只有 68x82 时够用，但扩到 280x270 后：
    // 相机在 y≈32、俯角 35°，到屏幕边缘的地面距离超过 105，
    // 那些地面被雾**完全遮盖**，显示成雾色 #D9E4EA -> 经过色阶后
    // 看起来就是一片"海水蓝"（实测采样 rgb(122,183,206)）。
    // 排查过程绕了很久：先怀疑是海面平面、又怀疑地面块被视锥剔除，
    // 都不对；最后把海删掉、背景改纯黑，那片蓝依然在 —— 才定位到雾。
    //
    // 新值 far=520：覆盖世界对角线 280√2≈400 的可见范围。
    // 雾只用来柔化最远处，不再遮住中景。
    scene.fog = new THREE.Fog(new THREE.Color('#D9E4EA'), 300, 520);

    // ---- 光照 ----
    // 结构说明（调色时最容易被误判的一段）：
    //   AmbientLight  只给整体一个常数亮度，对 Toon 的"暗部"几乎无帮助
    //   HemisphereLight 天空色打顶、地面色打底，才能真正把背光面提亮
    // 踩过的坑：只靠 Ambient + Directional 时，五重塔背光面被 Toon 暗部
    // 压成深红，看上去像"颜色调错了"，实际是补光不足。
    var ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    W.ambient = ambient;

    var hemi = new THREE.HemisphereLight(0xDCEAF2, 0xB8C89A, 0.62);
    scene.add(hemi);
    W.hemi = hemi;

    var sun = new THREE.DirectionalLight(0xfff6e8, 1.62);
    sun.position.set(16, 26, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var d = 42;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 130;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);
    W.sun = sun;

    // 补光（让背光面不至于太死）
    var fill = new THREE.DirectionalLight(0xB8DCE8, 0.42);
    fill.position.set(-18, 12, -16);
    scene.add(fill);
    W.fill = fill;
    // ---- 地面 ----
    // 按 G.terrain.height(x,z) 生成分段网格，支持坡坎/溪谷/盆地/山体/海岸。
    // 城镇区域高度恒为 0（terrain 内部用 townWeight 强制），所以城镇仍是平的。
    W.ground = [];

    function buildGroundMesh(opts) {
      // opts: {minX,maxX,minZ,maxZ,segX,segZ,color,repeat,seed}
      var geo = new THREE.PlaneGeometry(
        opts.maxX - opts.minX,
        opts.maxZ - opts.minZ,
        opts.segX, opts.segZ
      );
      geo.rotateX(-Math.PI / 2);

      // 把顶点按高度场抬高，并给顶点色做明暗层次
      var pos = geo.attributes.position;
      var colors = new Float32Array(pos.count * 3);
      var cx = (opts.minX + opts.maxX) / 2;
      var cz = (opts.minZ + opts.maxZ) / 2;
      // 注意：贴图本身已经是 opts.color 了，材质 color 是白色。
      // 所以顶点色必须是**围绕白色**的乘数（0.86~1.10），
      // 不能再用 baseCol 去乘，否则 map x color x vertexColor 三重相乘，
      // 草地会变成暗黄橄榄色（踩过一次完全一样的坑）。
      var darkMul = 0.86;
      var lightMul = 1.10;

      // 【关键：顶点保留**局部坐标**，世界位置只靠 mesh.position 表达】
      //
      // 踩过的坑（花了很久才定位）：原来这里写 pos.setX(i, wx)，即把顶点
      // 直接抬成世界坐标，然后 mesh.position 又设成 (cx, 0, cz) —— 双重偏移。
      // 结果每个 60x60 的块实际落在 [2cx-30, 2cx+30]，块与块之间出现
      // 大片空洞，玩家看到的是背景色（浅蓝），看起来像"地面上冒出一片海"。
      //
      // 现在：顶点 x/z 保持 PlaneGeometry 原始的局部值（±size/2），
      // 只用 wx/wz 去采样地形高度；世界定位交给 mesh.position。
      for (var i = 0; i < pos.count; i++) {
        var lx = pos.getX(i);      // 局部 x
        var lz = pos.getZ(i);      // 局部 z
        var wx = lx + cx;          // 世界 x（仅用于采样）
        var wz = lz + cz;          // 世界 z（仅用于采样）
        var h = G.terrain.height(wx, wz);
        pos.setY(i, h);

        // 顶点色：高处偏亮、低处偏暗，加一点确定性抖动避免死板
        var t = G.M.clamp01((h + 2) / 9);
        var jitter = (Math.sin(wx * 1.7) * Math.cos(wz * 1.3)) * 0.03;
        var v = darkMul + (lightMul - darkMul) * G.M.clamp01(t + jitter);
        colors[i * 3] = v;
        colors[i * 3 + 1] = v;
        colors[i * 3 + 2] = v;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      var mat = G.celMaterial('#FFFFFF', {
        steps: 2,
        darkness: 0.86,
        map: G.art.grassTexture({
          base: opts.color,
          repeat: opts.repeat || 8,
          seed: opts.seed || 5
        }),
        vertexColors: true
      });

      var m = new THREE.Mesh(geo, mat);
      m.position.set(cx, 0, cz);
      m.receiveShadow = true;
      return m;
    }

    // ---- 地面 ----
    // 2026-11 扩建：世界从 68x82 扩到 240x300。
    // 单张大网格会有 4 万+ 顶点，而且无法视锥剔除（永远整张渲染）。
    //
    // 改为**分块生成**：把世界切成 TILE 大小的方块，每块独立 mesh。
    // 好处：three.js 能对视锥外的块做剔除；顶点数分散也更利于驱动缓存。
    // 块边界处顶点法线不连续的问题用 computeVertexNormals 逐块计算，
    // 因为地形函数是连续的，高度不会在块边界断裂，只有法线有极轻微差异，
    // 在 3 阶色阶下看不出来。
    W.ground = [];

    var TILE = 60;   // 每块 60x60 世界单位
    var WORLD = G.DATA.WORLD;
    var TOWN = G.DATA.TOWN;

    // 城镇单独一块（土色，平坦），范围略大于 TOWN 以便衔接
    var townMesh = buildGroundMesh({
      minX: TOWN.minX - 6, maxX: TOWN.maxX + 6,
      minZ: TOWN.minZ - 6, maxZ: TOWN.maxZ + 6,
      segX: 40, segZ: 32,
      color: '#C9A87C', repeat: 10, seed: 3
    });
    scene.add(townMesh);
    W.ground.push(townMesh);

    // 野外：按块铺满整个世界范围（含边缘余量，避免看到天空）
    var PAD = 40;   // 世界边界外再铺一圈，防止相机看到边缘
    var x0 = WORLD.minX - PAD, x1 = WORLD.maxX + PAD;
    var z0 = WORLD.minZ - PAD, z1 = WORLD.maxZ + PAD;

    var tileCount = 0;
    // 块之间**故意重叠** OVERLAP 单位。
    //
    // 【为什么要重叠】纯拼接的块在浮点边界与地形起伏下会出现细缝，
    // 缝里露出的是背景色（浅蓝），肉眼看起来像"地面破洞冒海水"。
    // 实测：只渲染地面块时，蓝点位置采到的是清屏色 rgb(255,0,255)，
    // 证明那里确实没有几何体。
    // 重叠 4 单位后，任何浮点误差都被下一块盖住。
    var OVERLAP = 4;
    for (var tx = x0; tx < x1; tx += TILE) {
      for (var tz = z0; tz < z1; tz += TILE) {
        var mx0 = tx, mx1 = Math.min(tx + TILE, x1);
        var mz0 = tz, mz1 = Math.min(tz + TILE, z1);
        // 跳过完全落在城镇范围内的块（已被 townMesh 覆盖，避免 z-fighting）
        if (mx1 <= TOWN.maxX + 6 && mx0 >= TOWN.minX - 6 &&
            mz1 <= TOWN.maxZ + 6 && mz0 >= TOWN.minZ - 6) continue;

        // 每块 24x24 段，即 2.5 单位一格，足够表现地形起伏
        var seg = 24;
        var mesh = buildGroundMesh({
          minX: mx0 - OVERLAP, maxX: mx1 + OVERLAP,
          minZ: mz0 - OVERLAP, maxZ: mz1 + OVERLAP,
          segX: seg, segZ: seg,
          color: G.PALETTE.grass,
          repeat: 8, seed: 9 + tileCount
        });
        // 重叠块之间靠轻微的 Y 偏移避免 z-fighting（错开 2cm，肉眼不可见）
        //
        // 【必须用 += 而不是 = 】
        // buildGroundMesh 内部已经把 position 设成 (cx, 0, cz)。
        // 这里若直接赋值 y，会把 cx/cz 一起抹成 0 ——
        // 37 个地面块全部叠到世界原点，中心处重叠 37 层，
        // 表现为：画面异常 + 帧率崩塌 + 大片区域没有地面（露出背景色）。
        // 这个 bug 我排查了很久，症状和"海面太大""雾太近""视锥剔除"都很像。
        mesh.position.y += (tileCount % 7) * 0.02;
        scene.add(mesh);
        W.ground.push(mesh);
        tileCount++;
      }
    }
    W.groundTileCount = tileCount;

    // 世界边界（不可见的围栏）——用碰撞体实现，不画几何
    // ---- 静态物件 ----
    W.props = [];
    W.colliders = [];
    W.interactables = [];

    // 原来的結ノ町 + 霞ヶ原物件
    var D = G.DATA.PROPS;
    for (var i = 0; i < D.length; i++) {
      var spec = D[i];
      var obj = W.buildProp(spec);
      if (!obj) continue;
      scene.add(obj);
      W.props.push({ spec: spec, obj: obj });
    }

    // ---- 新地区物件（神山 / 码头 / 沙滩）----
    // 手工摆放的关键地标
    if (G.DATA.REGION_PROPS) {
      for (var r = 0; r < G.DATA.REGION_PROPS.length; r++) {
        var rspec = G.DATA.REGION_PROPS[r];
        var robj = W.buildProp(rspec);
        if (!robj) continue;
        scene.add(robj);
        W.props.push({ spec: rspec, obj: robj });
      }
    }

    // 程序化撒的装饰物（山石、松树、贝壳、草丛）
    if (G.DATA.generateRegionDecor) {
      var decor = G.DATA.generateRegionDecor();
      for (var d2 = 0; d2 < decor.length; d2++) {
        var dspec = decor[d2];
        var dobj = W.buildProp(dspec);
        if (!dobj) continue;
        scene.add(dobj);
        W.props.push({ spec: dspec, obj: dobj });
      }
    }
    // ---- NPC ----
    W.buildNPCs();

    // ---- 批量植被（草丛 + 野花）----
    // 性能要点：绝不能每丛草一个 Mesh（会产生上千 draw call）。
    // 这里用 InstancedMesh：一次 draw call 画几百丛。
    W.buildVegetation();
    // ---- 刷怪区 ----
    W.spawnZones = [];
    var allZones = G.DATA.SPAWN_ZONES.slice();
    // 新地区刷怪区（神山 / 码头 / 沙滩）
    if (G.DATA.REGION_SPAWN_ZONES) {
      allZones = allZones.concat(G.DATA.REGION_SPAWN_ZONES);
    }
    for (var s = 0; s < allZones.length; s++) {
      var z = allZones[s];
      W.spawnZones.push({
        data: z, timer: 2, alive: []
      });
    }

    return scene;
  };

  /** 按 spec 构建单个场景物件 */
  W.buildProp = function (spec, parentScene) {
    var scene = parentScene || W.scene;
    var obj = null;
    var art = G.art;

    switch (spec.type) {
      case 'torii':
        obj = art.torii({ width: spec.w || 5, height: spec.h || 6 });
        // 鸟居柱子加碰撞
        W.addCircleCollider(spec.x - (spec.w || 5) / 2, spec.z, 0.55);
        W.addCircleCollider(spec.x + (spec.w || 5) / 2, spec.z, 0.55);
        break;

      case 'lantern':
        obj = art.lantern({ poleH: spec.poleH || 2.6 });
        W.addCircleCollider(spec.x, spec.z, 0.32);
        break;

      case 'sakura':
        obj = art.sakura({ scale: spec.scale || 1, seed: spec.seed || 1 });
        W.addCircleCollider(spec.x, spec.z, 0.55 * (spec.scale || 1));
        break;

      case 'house':
        obj = art.house({
          w: spec.w, d: spec.d, h: spec.h,
          noren: spec.noren,
          roof: spec.roof
        });
        // 房屋用矩形碰撞
        W.addBoxCollider(spec.x, spec.z, spec.w, spec.d, spec.rotY || 0);
        break;

      case 'bamboo':
        obj = art.bamboo({ count: spec.count, spread: spec.spread, seed: spec.seed });
        W.addCircleCollider(spec.x, spec.z, 0.8);
        break;

      case 'stairs':
        obj = art.stoneStairs({ steps: spec.steps, w: spec.w, rise: spec.rise, run: spec.run });
        break;

      case 'path':
        obj = art.path({ w: spec.w, d: spec.d, y: spec.y, x: spec.x, z: spec.z, seed: spec.seed });
        break;

      case 'pagoda':
        obj = art.pagoda({
          tiers: spec.tiers, baseW: spec.baseW,
          color: spec.color, roof: spec.roof
        });
        W.addCircleCollider(spec.x, spec.z, (spec.baseW || 5) * 0.72);
        break;

      case 'stoneLantern':
        obj = art.stoneLantern({ scale: spec.scale });
        W.addCircleCollider(spec.x, spec.z, 0.4 * (spec.scale || 1));
        break;

      case 'rock': {
        obj = art.rock({ size: spec.size, seed: spec.seed });
        W.addCircleCollider(spec.x, spec.z, (spec.size || 0.7) * 0.8);
        break;
      }

      case 'bush':
        obj = art.bush({ seed: spec.seed });
        break;

      case 'fence':
        obj = art.fence({ len: spec.len });
        break;

      case 'water':
        obj = art.water({ w: spec.w, d: spec.d, y: spec.y });
        // 水面不挡路，但降低移动速度（由 terrain query 处理）
        break;

      case 'stele': {
        obj = art.stele();
        W.addCircleCollider(spec.x, spec.z, 0.45);
        W.interactables.push({
          uid: spec.uid, kind: 'stele', x: spec.x, z: spec.z,
          radius: 2.2, obj: obj,
          text: G.DATA.STELES && G.DATA.STELES[spec.uid] || '……字迹已经被雨水磨平了。'
        });
        break;
      }

      case 'knot': {
        obj = art.knot({ color: spec.color });
        W.interactables.push({
          uid: spec.uid, kind: 'knot', x: spec.x, z: spec.z,
          radius: 2.6, obj: obj
        });
        break;
      }

      case 'chest': {
        obj = art.chest();
        W.addCircleCollider(spec.x, spec.z, 0.4);
        W.interactables.push({
          uid: spec.uid, kind: 'chest', x: spec.x, z: spec.z,
          radius: 1.9, obj: obj, loot: spec.loot || 'common', opened: false
        });
        break;
      }

      case 'pot': {
        obj = art.pot();
        W.interactables.push({
          uid: spec.uid, kind: 'pot', x: spec.x, z: spec.z,
          radius: 1.5, obj: obj, broken: false, isDestructible: true
        });
        break;
      }

      case 'node': {
        obj = art.resourceNode({ type: spec.nodeType });
        W.interactables.push({
          uid: spec.uid, kind: 'node', nodeType: spec.nodeType,
          x: spec.x, z: spec.z, radius: 1.7, obj: obj,
          remaining: 3, cooldown: 0
        });
        break;
      }

      case 'shrine': {
        obj = art.shrine();
        W.addCircleCollider(spec.x, spec.z, 1.2);
        W.interactables.push({
          uid: spec.uid || 'shrine_town', kind: 'shrine', x: spec.x, z: spec.z,
          radius: 2.4, obj: obj
        });
        break;
      }

      // ===== 新地区专属物件 =====
      case 'sea':
        obj = art.sea({ w: spec.w, d: spec.d });
        // 海不挡路（可以走进去但会被 underwater 减速）
        break;

      case 'beachSand':
        obj = art.beachSand({ w: spec.w, d: spec.d, x: spec.x, z: spec.z });
        break;

      case 'reef':
        obj = art.reef({ seed: spec.seed });
        W.addCircleCollider(spec.x, spec.z, 1.0);
        break;

      case 'pier':
        obj = art.pier({ len: spec.len, w: spec.w, deckY: spec.deckY });
        W.addBoxCollider(spec.x, spec.z, spec.w || 3.2, spec.len || 14, spec.rotY || 0);
        break;

      case 'boat':
        obj = art.boat({ len: spec.len, w: spec.w, color: spec.color });
        W.addCircleCollider(spec.x, spec.z, (spec.w || 1.5) * 0.8);
        break;

      case 'crate':
        obj = art.crate({ size: spec.size, seed: spec.seed });
        W.addCircleCollider(spec.x, spec.z, (spec.size || 0.7) * 0.8);
        break;

      case 'barrel':
        obj = art.barrel({ r: spec.r, h: spec.h, seed: spec.seed });
        W.addCircleCollider(spec.x, spec.z, (spec.r || 0.35) * 1.2);
        break;

      case 'fishingNet':
        obj = art.fishingNet({ w: spec.w, h: spec.h });
        break;

      case 'mountainRock':
        obj = art.mountainRock({ size: spec.size, seed: spec.seed });
        W.addCircleCollider(spec.x, spec.z, (spec.size || 2.2) * 0.6);
        break;

      case 'mountainStairs':
        obj = art.mountainStairs({
          steps: spec.steps, w: spec.w, rise: spec.rise, run: spec.run
        });
        break;

      case 'mist':
        obj = art.mist({
          count: spec.count, spread: spec.spread,
          scale: spec.scale, opacity: spec.opacity, color: spec.color
        });
        break;

      case 'banner':
        obj = art.banner({ h: spec.h, color: spec.color });
        W.addCircleCollider(spec.x, spec.z, 0.25);
        break;

      case 'gate': {
        // 副本入口：两扇石门 + 幽光
        var g = new THREE.Group();
        var frameColor = G.PALETTE.stoneDark;
        [-1, 1].forEach(function (s) {
          var pillar = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 5.2, 0.9),
            G.celMaterial(frameColor, { steps: 2 })
          );
          pillar.position.set(s * 3.2, 2.6, 0);
          pillar.castShadow = true;
          g.add(pillar);
        });
        var lintel = new THREE.Mesh(new THREE.BoxGeometry(8, 0.8, 1.0),
          G.celMaterial(frameColor, { steps: 2 }));
        lintel.position.set(0, 5.4, 0);
        lintel.castShadow = true;
        g.add(lintel);
        // 门洞里的幽光面
        var glowMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#8FC4D8'), transparent: true, opacity: 0.45,
          side: THREE.DoubleSide, depthWrite: false
        });
        var glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 4.8), glowMat);
        glowPlane.position.set(0, 2.5, 0);
        g.add(glowPlane);
        g.userData.glow = glowMat;
        obj = g;
        W.addCircleCollider(spec.x - 3.2, spec.z, 0.6);
        W.addCircleCollider(spec.x + 3.2, spec.z, 0.6);
        W.interactables.push({
          uid: spec.uid || 'gate_dungeon', kind: 'gate', x: spec.x, z: spec.z,
          radius: 3.2, obj: g,
          // 记录该门通往哪个副本（神山 / 沙滩 / 忘れ緒の社）
          region: spec.region || 'wasureo'
        });
        break;
      }
    }

    if (obj) {
      obj.position.x = spec.x;
      obj.position.z = spec.z;
      // 贴地：所有道具都放在地面上。
      //
      // 例外清单（这些自己管高度，再抬一次会出错）：
      //   water/gate/sea   : 自己算高度
      //   path/mountainStairs/beachSand : 内部已按世界坐标逐顶点算过高度，再抬会 double-offset
      //   pier             : 栈桥本身有固定 deckY，不跟地形走
      //   mist             : 云雾飘在空中，不贴地
      var NO_GROUND = {
        water: 1, gate: 1, sea: 1,
        path: 1, mountainStairs: 1, beachSand: 1,
        pier: 1, mist: 1
      };
      if (!NO_GROUND[spec.type]) {
        obj.position.y = W.groundY(spec.x, spec.z);
      }
      if (spec.rotY) obj.rotation.y = spec.rotY;
      obj.userData.spec = spec;
      obj.userData.baseY = obj.position.y;
      obj.userData.floatPhase = Math.random() * 6.28;

      // 烘焙接地 AO：越贴近地面的部分越暗。
      // 排除：水面/路径/高塔/结/门/海/沙滩/栈桥/云雾（理由见 NO_GROUND）
      var NO_AO = {
        water: 1, path: 1, pagoda: 1, knot: 1, gate: 1, sea: 1,
        beachSand: 1, pier: 1, mist: 1, fishingNet: 1
      };
      if (!NO_AO[spec.type]) {
        W.bakeContactAO(obj, W.groundY(spec.x, spec.z), {
          strength: (spec.type === 'house' || spec.type === 'boat') ? 0.38 : 0.42
        });
      }
    }
    return obj;
  };

  // =====================================================================
  // 批量植被（InstancedMesh，单 draw call）
  // =====================================================================
  W.buildVegetation = function () {
    var rnd = G.mulberry32(90210);
    var W_D = G.DATA.WORLD;

    // 采样区域：只铺野外（城镇保持干净）
    var TOWN = G.DATA.TOWN;
    function inField(x, z) {
      if (x >= TOWN.minX && x <= TOWN.maxX && z >= TOWN.minZ && z <= TOWN.maxZ) return false;
      if (z < 14) return false;
      return true;
    }
    // ---- 草丛 ----
    var tuftCount = 420;
    var tuftGeo = new THREE.PlaneGeometry(0.5, 0.34);
    var tuftMat = G.celMaterial('#9CB87A', {
      steps: 2, darkness: 0.9, side: THREE.DoubleSide,
      transparent: true, alphaTest: 0.4
    });
    var tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCount * 2);
    tufts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tufts.receiveShadow = false;
    tufts.castShadow = false;

    var m4 = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var pos = new THREE.Vector3();
    var scale = new THREE.Vector3();
    var idx = 0;

    for (var i = 0; i < tuftCount; i++) {
      var x = W_D.minX + rnd() * (W_D.maxX - W_D.minX);
      var z = 14 + rnd() * 52;
      if (!inField(x, z)) continue;
      // 不在水里
      if (G.terrain.isUnderwater(x, z)) continue;

      var gy = G.terrain.height(x, z);
      var s = 0.7 + rnd() * 0.7;

      // 每丛两片交叉
      for (var k = 0; k < 2; k++) {
        var ang = rnd() * Math.PI + k * Math.PI / 2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
        pos.set(x, gy + 0.16 * s, z);
        scale.set(s, s, s);
        m4.compose(pos, q, scale);
        tufts.setMatrixAt(idx++, m4);
      }
    }
    tufts.count = idx;
    tufts.instanceMatrix.needsUpdate = true;
    W.scene.add(tufts);
    W.vegetation = W.vegetation || {};
    W.vegetation.tufts = tufts;
    // ---- 野花 ----
    var flowerCount = 150;
    var flowerGeo = new THREE.IcosahedronGeometry(0.09, 0);
    var flowerColors = ['#F7C8D8', '#FBF3E4', '#E8C25A', '#D9A0E8'];
    var flowerMat = G.celMaterial('#FFFFFF', { steps: 2, darkness: 0.9, vertexColors: false });
    // 用 InstancedMesh + instanceColor 上色
    var flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
    flowers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(flowerCount * 3), 3);

    var fIdx = 0;
    for (var f = 0; f < flowerCount; f++) {
      var fx = W_D.minX + rnd() * (W_D.maxX - W_D.minX);
      var fz = 15 + rnd() * 50;
      if (!inField(fx, fz)) continue;
      if (G.terrain.isUnderwater(fx, fz)) continue;

      var fgy = G.terrain.height(fx, fz);
      var fs = 0.8 + rnd() * 0.6;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      pos.set(fx, fgy + 0.3 * fs, fz);
      scale.set(fs, fs, fs);
      m4.compose(pos, q, scale);
      flowers.setMatrixAt(fIdx, m4);

      var c = new THREE.Color(flowerColors[Math.floor(rnd() * flowerColors.length)]);
      flowers.instanceColor.setXYZ(fIdx, c.r, c.g, c.b);
      fIdx++;
    }
    flowers.count = fIdx;
    flowers.instanceMatrix.needsUpdate = true;
    flowers.instanceColor.needsUpdate = true;
    W.scene.add(flowers);
    W.vegetation.flowers = flowers;
  };

  /**
   * 给一组几何体烘焙"接地 AO"：越靠近地面越暗。
   *
   * 为什么用顶点色而不是 SSAO：
   *   SSAO 需要额外 G-Buffer + 多次采样，在 640x360 上每帧都是明显的开销，
   *   而且 file:// 单文件下没有后处理链可用。顶点色烘焙是零运行时成本，
   *   且这类"物体与地面的接触阴影"本来就是静态的，烘一次就够。
   *
   * 【踩过的坑：AO 把细高物体烧黑】
   * 初版对石灯笼/竹子也用了 falloff=1.3、strength=0.5。这两类物体
   * 整体高度只有 1~2 单位，顶点几乎全部落在 falloff 之内，
   * AO 系数接近 0.5，再叠加 Toon 暗部 -> 渲染成黑灰色块。
   * 正确做法：falloff 必须与物体自身高度成比例，
   * 只让"真正贴地的那一小段"变暗。
   *
   * @param {THREE.Group} group
   * @param {number} groundY 该物件所在地面高度
   * @param {object} opt { strength, falloff, height }
   */
  // AO 材质缓存（按源材质 UUID）——避免对同一材质反复 clone。
  // 必须在使用它的 bakeContactAO 之前声明（var 会提升但值是 undefined）。
  var AO_MAT_CACHE = {};

  W.bakeContactAO = function (group, groundY, opt) {
    opt = opt || {};
    var strength = opt.strength != null ? opt.strength : 0.5;

    // 先量出这个 group 的实际高度范围
    var box = new THREE.Box3().setFromObject(group);
    var groupHeight = Math.max(0.5, box.max.y - (groundY || 0));

    // falloff 默认取高度的 22%，最少 0.35：
    // 这样只有底部一小圈被压暗，不会把整个物体烧掉。
    var falloff = opt.falloff != null
      ? opt.falloff
      : Math.max(0.35, groupHeight * 0.22);

    group.traverse(function (node) {
      if (!node.isMesh || !node.geometry) return;
      var geo = node.geometry;
      if (geo.attributes.color) return;   // 已经烘过

      var pos = geo.attributes.position;
      if (!pos) return;

      // 【性能】只算 Y，不算完整世界变换。
      //
      // 原来每个顶点都 new Vector3 + fromBufferAttribute + applyMatrix4，
      // 一次 4x4 矩阵乘 —— 单个 torii（~10 个 mesh × 数百顶点）就要
      // 几十毫秒。而 AO 只需要"离地多高"，即世界 y；
      // 世界 y = 局部 y * scaleY + position.y，平移旋转对 y 的影响
      // 在物件尺度下可以忽略（物件不会大幅横躺）。
      // 实测 torii 的 bakeContactAO 从 ~70ms 降到 <5ms。
      var my = node.matrixWorld.elements[13];        // 世界平移 y
      var sy = node.matrixWorld.elements[5];         // 世界 y 轴缩放分量
      var colors = new Float32Array(pos.count * 3);

      for (var i = 0; i < pos.count; i++) {
        var h = pos.getY(i) * sy + my - groundY;
        var t = G.M.clamp01(h / falloff);
        // 平滑衰减：只有最底部接近 1-strength
        var ao = 1 - strength * (1 - t) * (1 - t);
        colors[i * 3] = ao;
        colors[i * 3 + 1] = ao;
        colors[i * 3 + 2] = ao;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      // 【关键】必须给这个 mesh 一个**独立的材质副本**。
      //
      // 踩过的坑：material 是全局缓存共享的（art 里的 mat()/texMat() 按颜色缓存）。
      // 直接 node.material.vertexColors = true 会污染所有使用同一材质的 mesh，
      // 包括那些**没有 color 属性**的 mesh —— 它们会被渲染成纯黑。
      // 实例：五重塔基座用石色 #c8c3b8，与房屋/石灯笼共用同一材质；
      //       后者走 AO 把共享材质标成 vertexColors:true，塔基座就变成黑砖。
      // 修法：clone 一份专属材质再标记，互不影响。
      //
      // 【性能】clone 很贵（要复制 uniforms、准备 shader 变体），
      // 所以按源材质 UUID 做缓存：同一材质的多个 mesh 共用一个 AO 副本。
      var srcMat = node.material;
      if (srcMat && !srcMat.vertexColors) {
        if (!AO_MAT_CACHE[srcMat.uuid]) {
          var aoMat = srcMat.clone();
          aoMat.vertexColors = true;
          aoMat.needsUpdate = true;
          AO_MAT_CACHE[srcMat.uuid] = aoMat;
        }
        node.material = AO_MAT_CACHE[srcMat.uuid];
      }
    });
  };

  // ---------- 碰撞体（手工简单形状，够用且快） ----------
  W.addCircleCollider = function (x, z, r) {
    W.colliders.push({ kind: 'circle', x: x, z: z, r: r });
  };
  W.addBoxCollider = function (x, z, w, d, rotY) {
    W.colliders.push({ kind: 'box', x: x, z: z, w: w, d: d, rotY: rotY || 0 });
  };

  /**
   * 取某点的地面高度。所有实体的 y 都应该经过这里，
   * 不要直接写字面量（踩过：地形改造后实体半埋进土里）。
   */
  W.groundY = function (x, z) {
    return G.terrain ? G.terrain.height(x, z) : 0;
  };

  /** 水面高度（河） */
  W.waterY = function () {
    return G.terrain ? G.terrain.waterLevel() : -1.15;
  };

  /** 把点推出所有碰撞体；返回修正后的位置 */
  var _tmp = { x: 0, z: 0 };
  W.resolveCollision = function (x, z, radius) {
    radius = radius || 0.34;
    var i, c, dx, dz, dist, minDist;
    for (i = 0; i < W.colliders.length; i++) {
      c = W.colliders[i];
      if (c.kind === 'circle') {
        dx = x - c.x; dz = z - c.z;
        dist = Math.sqrt(dx * dx + dz * dz);
        minDist = c.r + radius;
        if (dist < minDist && dist > 1e-5) {
          var push = (minDist - dist) / dist;
          x += dx * push;
          z += dz * push;
        } else if (dist <= 1e-5) {
          x += minDist; // 完全重合时随便推开
        }
      } else {
        // 旋转盒：转到局部坐标判断
        var cos = Math.cos(-c.rotY), sin = Math.sin(-c.rotY);
        var lx = (x - c.x) * cos - (z - c.z) * sin;
        var lz = (x - c.x) * sin + (z - c.z) * cos;
        var hw = c.w / 2 + radius, hd = c.d / 2 + radius;
        if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
          // 沿最短轴推出
          var ox = hw - Math.abs(lx);
          var oz = hd - Math.abs(lz);
          if (ox < oz) lx = lx >= 0 ? hw : -hw;
          else lz = lz >= 0 ? hd : -hd;
          // 转回世界
          var c2 = Math.cos(c.rotY), s2 = Math.sin(c.rotY);
          x = c.x + lx * c2 - lz * s2;
          z = c.z + lx * s2 + lz * c2;
        }
      }
    }
    // 世界边界
    var B = G.DATA.WORLD;
    if (x < B.minX) x = B.minX;
    if (x > B.maxX) x = B.maxX;
    if (z < B.minZ) z = B.minZ;
    if (z > B.maxZ) z = B.maxZ;
    _tmp.x = x; _tmp.z = z;
    return _tmp;
  };

  /** 判断是否在城镇安全区 */
  W.inTown = function (x, z) {
    var T = G.DATA.TOWN;
    return x >= T.minX && x <= T.maxX && z >= T.minZ && z <= T.maxZ;
  };

  /** 地形速度系数（水里慢、陡坡也慢） */
  W.terrainSpeed = function (x, z) {
    var mul = 1;
    // 水中
    if (G.terrain && G.terrain.isUnderwater(x, z)) mul *= 0.62;
    // 陡坡（超过 0.35 的坡度开始减速）
    if (G.terrain) {
      var st = G.terrain.steepness(x, z);
      if (st > 0.35) mul *= Math.max(0.55, 1 - (st - 0.35) * 0.9);
    }
    return mul;
  };

  // =====================================================================
  // NPC
  // =====================================================================
  W.buildNPCs = function () {
    W.npcs = [];
    for (var i = 0; i < G.DATA.NPCS.length; i++) {
      var def = G.DATA.NPCS[i];
      var look = G.makeLook(def.look);
      var atlas = G.getChibiAtlas(look, def.id);
      var m = G.makeChibiMesh(atlas, { worldH: 2.45 });
      var sp = W.isNight() ? def.night : def.day;
      m.position.set(sp.x, W.groundY(sp.x, sp.z) + 1.225, sp.z);
      W.scene.add(m);
      var npc = {
        def: def, look: look, atlas: atlas, mesh: m,
        x: sp.x, z: sp.z,
        dir: 4, animPhase: 'idle', animFrame: 0, animT: 0,
        tick: Math.random() * 3
      };
      G.sprite.update(m, atlas, 4, 'idle', 0);
      W.npcs.push(npc);
      W.addCircleCollider(sp.x, sp.z, 0.4);
    }
  };

  /** 昼夜切换时把 NPC 挪到对应位置 */
  W.relocateNPCs = function () {
    var night = W.isNight();
    for (var i = 0; i < W.npcs.length; i++) {
      var npc = W.npcs[i];
      var target = night ? npc.def.night : npc.def.day;
      npc.x = target.x; npc.z = target.z;
      npc.mesh.position.x = target.x;
      npc.mesh.position.z = target.z;
      npc.mesh.position.y = W.groundY(target.x, target.z) + 1.225;
    }
  };

  // =====================================================================
  // 昼夜（isNight / nightFactor / duskFactor 定义在文件顶部，build 之前）
  // =====================================================================

  W.updateDayNight = function (dt) {
    var prevNight = W.isNight();
    W.timeOfDay += dt / W.dayLengthSec;
    if (W.timeOfDay >= 1) {
      W.timeOfDay -= 1;
      W.dayCount++;
      G.bus.emit('day:passed', W.dayCount);
    }
    if (W.isNight() !== prevNight) {
      W.relocateNPCs();
      G.bus.emit('phase:changed', W.isNight() ? 'night' : 'day');
    }

    // ---- 光照插值 ----
    var n = W.nightFactor();
    var dusk = W.duskFactor();
    var t = G.M.clamp01(n);

    // 白天：暖白高强度；夜晚：冷蓝低强度
    // 踩过：ambient 0.78 + sun 1.15 + darkness 0.5 的组合让白墙变灰，
    // 提高 material darkness 到 0.72 后仍需把 sun 拉到 1.6
    var sunColor = new THREE.Color('#FFF6E8').lerp(new THREE.Color('#4A5A8C'), t);
    if (dusk > 0) {
      sunColor.lerp(new THREE.Color('#FFB070'), dusk * 0.85 * (1 - t * 0.4));
    }
    var sunIntensity = G.M.lerp(1.62, 0.42, t);
    var ambIntensity = G.M.lerp(0.55, 0.3, t);
    var hemiIntensity = G.M.lerp(0.62, 0.26, t);
    var fillIntensity = G.M.lerp(0.42, 0.25, t);

    W.sun.color.copy(sunColor);
    W.sun.intensity = sunIntensity;
    W.ambient.intensity = ambIntensity;
    if (W.hemi) W.hemi.intensity = hemiIntensity;
    if (W.fill) W.fill.intensity = fillIntensity;

    // 天空
    var skyDay = new THREE.Color(G.PALETTE.sky);
    var skyNight = new THREE.Color(G.PALETTE.nightSky);
    var bgColor = skyDay.clone().lerp(skyNight, t);
    if (dusk > 0) {
      bgColor.lerp(new THREE.Color('#F5B078'), dusk * 0.6);
    }
    W.scene.background.copy(bgColor);

    // 雾
    // 范围必须与 init 里的 scene.fog 保持一致量级（见那里的注释：
    // 世界扩建后旧值 62~105 会把中景地面整片糊成雾色，看起来像海水）。
    var fogColor = bgColor.clone().lerp(new THREE.Color('#FFFFFF'), 0.18);
    if (W.scene.fog) {
      W.scene.fog.color.copy(fogColor);
      W.scene.fog.near = G.M.lerp(300, 240, t);
      W.scene.fog.far = G.M.lerp(520, 420, t);
    }

    // 太阳位置
    // timeOfDay 0.25 = 日出（东），0.5 = 正午（顶），0.75 = 日落（西）
    var dayAngle = (W.timeOfDay - 0.25) / 0.5 * Math.PI;  // 白天 0..PI
    var sunH, sunX;
    if (W.timeOfDay >= 0.25 && W.timeOfDay <= 0.75) {
      sunH = Math.sin(dayAngle);
      sunX = -Math.cos(dayAngle);
    } else {
      // 夜间太阳在地平线以下（用月亮方向代替，视觉上保持有方向光）
      sunH = 0.35;
      sunX = 0.5;
    }
    W.sun.position.set(sunX * 34, Math.max(8, sunH * 40), 16 + sunH * 12);
    W.sun.target.position.set(0, 0, 30);
    W.sun.target.updateMatrixWorld();

    // 灯的亮度在夜间更明显
    for (var i = 0; i < W.props.length; i++) {
      var p = W.props[i];
      if (p.obj && p.obj.userData && p.obj.userData.light) {
        p.obj.userData.light.intensity = G.M.lerp(0.2, 2.2, t);
      }
    }
  };

  // =====================================================================
  // 刷怪
  // =====================================================================
  W.updateSpawns = function (dt) {
    if (W.inDungeon) return;
    var night = W.isNight();
    for (var i = 0; i < W.spawnZones.length; i++) {
      var z = W.spawnZones[i];
      var data = z.data;
      // 清理死掉的
      z.alive = z.alive.filter(function (e) { return !e.dead; });

      z.timer -= dt;
      if (z.timer <= 0) {
        var table = night ? data.night : data.day;
        var totalWanted = 0;
        for (var k = 0; k < table.length; k++) totalWanted += table[k].count;

        if (z.alive.length < totalWanted) {
          // 刷一只
          var pick = G.weighted(table.map(function (e) {
            return { weight: e.count, id: e.id };
          }));
          if (pick) {
            var pos = W.findSpawnPoint(data);
            if (pos) {
              var enemy = G.enemy.spawn(pick.id, pos.x, pos.z, z);
              if (enemy) { z.alive.push(enemy); }
            }
          }
          z.timer = 1.2;
        } else {
          z.timer = data.respawnSec;
        }
      }
    }
  };

  W.findSpawnPoint = function (zoneData) {
    var player = G.player && G.player.state;
    for (var attempt = 0; attempt < 12; attempt++) {
      var x = G.randRange(zoneData.minX, zoneData.maxX);
      var z = G.randRange(zoneData.minZ, zoneData.maxZ);
      // 不要刷在玩家脸上
      if (player) {
        var d = M.dist(x, z, player.x, player.z);
        if (d < 8) continue;
      }
      // 不要在碰撞体里
      var resolved = W.resolveCollision(x, z, 0.5);
      if (M.dist(resolved.x, resolved.z, x, z) > 0.2) continue;
      return { x: x, z: z };
    }
    return null;
  };

  // =====================================================================
  // 每帧更新（浮动、旋转）
  // =====================================================================
  W.update = function (dt, elapsed) {
    W.updateDayNight(dt);
    W.updateSpawns(dt);

    // 视觉小动画
    for (var i = 0; i < W.props.length; i++) {
      var p = W.props[i];
      var spec = p.spec;
      if (!p.obj) continue;
      if (spec.type === 'knot' && p.obj.userData.ring) {
        p.obj.userData.ring.rotation.z += dt * 0.8;
        var s = 1 + Math.sin(elapsed * 2 + p.obj.userData.floatPhase) * 0.06;
        if (p.obj.userData.core) {
          p.obj.userData.core.scale.setScalar(s);
          p.obj.userData.core.rotation.y += dt * 1.2;
        }
      }
      if (spec.type === 'chest' && p.obj.userData.lid) {
        // 未开启的宝箱轻微呼吸（提示可交互）
        var inter = W.interactables.find(function (it) { return it.uid === spec.uid; });
        if (inter && !inter.opened) {
          p.obj.position.y = Math.sin(elapsed * 1.6 + p.obj.userData.floatPhase) * 0.02;
        }
      }
      if (spec.type === 'bamboo' && p.obj.userData.stalks) {
        for (var b = 0; b < p.obj.userData.stalks.length; b++) {
          var st = p.obj.userData.stalks[b];
          var sway = Math.sin(elapsed * 0.9 + st.phase) * 0.02;
          st.mesh.rotation.z = st.baseRotZ + sway;
          if (st.baseRotX != null) st.mesh.rotation.x = st.baseRotX + sway * 0.6;
        }
      }
      if (spec.type === 'gate' && p.obj.userData.glow) {
        p.obj.userData.glow.opacity = 0.35 + Math.sin(elapsed * 1.8) * 0.12;
      }
    }
  };

  // ---------- 查询：最近的可交互物 ----------
  W.nearestInteractable = function (x, z, maxDist) {
    maxDist = maxDist || 2.4;
    var best = null, bestD = maxDist;
    for (var i = 0; i < W.interactables.length; i++) {
      var it = W.interactables[i];
      if (it.kind === 'chest' && it.opened) continue;
      if (it.kind === 'pot' && it.broken) continue;
      if (it.kind === 'node' && it.remaining <= 0) continue;
      var d = M.dist(x, z, it.x, it.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  };

  /** 附近的可破坏物（攻击时顺带打碎） */
  W.destructiblesNear = function (x, z, radius) {
    var out = [];
    for (var i = 0; i < W.interactables.length; i++) {
      var it = W.interactables[i];
      if (!it.isDestructible || it.broken) continue;
      if (M.dist(x, z, it.x, it.z) < radius) out.push(it);
    }
    return out;
  };

})(window.G = window.G || {});
