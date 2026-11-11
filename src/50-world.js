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
  // 构建
  // =====================================================================
  W.build = function () {
    var scene = new THREE.Scene();
    W.scene = scene;

    // 天空色（按时间）
    scene.background = new THREE.Color(G.PALETTE.sky);
    // 雾：起点必须远大于相机到玩家的距离（相机距离 34），
    // 否则整个画面糊成一片（踩过：near=34 时全屏发灰）
    scene.fog = new THREE.Fog(new THREE.Color('#D9E4EA'), 62, 105);

    // ---- 光照 ----
    var ambient = new THREE.AmbientLight(0xffffff, 0.92);
    scene.add(ambient);
    W.ambient = ambient;

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
    // 城镇地面：土黄
    var townGeo = new THREE.BoxGeometry(38, 0.6, 28);
    var townMesh = new THREE.Mesh(townGeo, G.art.groundMaterial('#C9A87C', { repeat: 7, seed: 3 }));
    townMesh.position.set(0, -0.3, 0);
    townMesh.receiveShadow = true;
    scene.add(townMesh);

    // 野外地面：草地（大）
    var fieldGeo = new THREE.BoxGeometry(72, 0.6, 56);
    var fieldMesh = new THREE.Mesh(fieldGeo, G.art.groundMaterial(G.PALETTE.grass, { repeat: 16, seed: 9 }));
    fieldMesh.position.set(0, -0.36, 39);
    fieldMesh.receiveShadow = true;
    scene.add(fieldMesh);

    // 世界边界（不可见的围栏）——用碰撞体实现，不画几何

    // ---- 静态物件 ----
    W.props = [];
    W.colliders = [];
    W.interactables = [];

    var D = G.DATA.PROPS;
    for (var i = 0; i < D.length; i++) {
      var spec = D[i];
      var obj = W.buildProp(spec);
      if (!obj) continue;
      scene.add(obj);
      W.props.push({ spec: spec, obj: obj });
    }

    // ---- NPC ----
    W.buildNPCs();

    // ---- 刷怪区 ----
    W.spawnZones = [];
    for (var s = 0; s < G.DATA.SPAWN_ZONES.length; s++) {
      var z = G.DATA.SPAWN_ZONES[s];
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
          uid: 'shrine_town', kind: 'shrine', x: spec.x, z: spec.z,
          radius: 2.4, obj: obj
        });
        break;
      }

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
          radius: 3.2, obj: g
        });
        break;
      }
    }

    if (obj) {
      obj.position.x = spec.x;
      obj.position.z = spec.z;
      if (spec.rotY) obj.rotation.y = spec.rotY;
      obj.userData.spec = spec;
      obj.userData.baseY = obj.position.y;
      obj.userData.floatPhase = Math.random() * 6.28;
    }
    return obj;
  };

  // ---------- 碰撞体（手工简单形状，够用且快） ----------
  W.addCircleCollider = function (x, z, r) {
    W.colliders.push({ kind: 'circle', x: x, z: z, r: r });
  };
  W.addBoxCollider = function (x, z, w, d, rotY) {
    W.colliders.push({ kind: 'box', x: x, z: z, w: w, d: d, rotY: rotY || 0 });
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

  /** 地形速度系数（水里慢） */
  W.terrainSpeed = function (x, z) {
    var props = W.props;
    for (var i = 0; i < props.length; i++) {
      var s = props[i].spec;
      if (s.type === 'water') {
        if (x > s.x - s.w / 2 && x < s.x + s.w / 2 &&
            z > s.z - s.d / 2 && z < s.z + s.d / 2) {
          return 0.62;
        }
      }
    }
    return 1;
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
      var m = G.makeChibiMesh(atlas, { worldH: 2.1 });
      var sp = W.isNight() ? def.night : def.day;
      m.position.set(sp.x, 1.05, sp.z);
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
    }
  };

  // =====================================================================
  // 昼夜
  // =====================================================================
  // timeOfDay: 0 = 午夜, 0.25 = 6:00 日出, 0.5 = 正午, 0.75 = 18:00 日落
  // 踩过的坑：最初 isNight 用 t>0.74||t<0.24，而 nightFactor 又写反，
  // 导致 07:41 显示月亮图标、白天画面像黄昏。
  var DAWN = 0.24, DUSK = 0.76;

  W.isNight = function () {
    var t = W.timeOfDay;
    return t < DAWN || t > DUSK;
  };

  /**
   * 夜色程度 0..1。
   * 0 = 完全白天（正午），1 = 深夜。
   * 日出/日落后各有 0.06 的过渡带。
   */
  W.nightFactor = function () {
    var t = W.timeOfDay;
    var TRANS = 0.07;
    if (t < DAWN - TRANS) return 1;                    // 深夜
    if (t < DAWN) return (DAWN - t) / TRANS;           // 黎明前
    if (t < DAWN + TRANS) return 1 - (t - DAWN) / TRANS; // 日出
    if (t < DUSK - TRANS) return 0;                    // 白天
    if (t < DUSK) return (t - (DUSK - TRANS)) / TRANS;  // 入夜
    if (t < DUSK + TRANS) return (t - DUSK) / TRANS > 1 ? 1 : (t - DUSK) / TRANS + 0.5;
    return 1;
  };

  /** 黄昏/黎明程度（用于染色） 0..1 */
  W.duskFactor = function () {
    var t = W.timeOfDay;
    var TRANS = 0.07;
    var a = 0;
    // 日出带
    if (t > DAWN - TRANS && t < DAWN + TRANS) {
      a = 1 - Math.abs(t - DAWN) / TRANS;
    }
    // 日落带
    if (t > DUSK - TRANS && t < DUSK + TRANS) {
      a = Math.max(a, 1 - Math.abs(t - DUSK) / TRANS);
    }
    return G.M.clamp01(a);
  };

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
    var ambIntensity = G.M.lerp(0.92, 0.52, t);
    var fillIntensity = G.M.lerp(0.42, 0.25, t);

    W.sun.color.copy(sunColor);
    W.sun.intensity = sunIntensity;
    W.ambient.intensity = ambIntensity;
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
    var fogColor = bgColor.clone().lerp(new THREE.Color('#FFFFFF'), 0.18);
    if (W.scene.fog) {
      W.scene.fog.color.copy(fogColor);
      W.scene.fog.near = G.M.lerp(62, 50, t);
      W.scene.fog.far = G.M.lerp(105, 82, t);
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
          st.mesh.rotation.z = st.baseRotZ + Math.sin(elapsed * 0.9 + st.phase) * 0.02;
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
