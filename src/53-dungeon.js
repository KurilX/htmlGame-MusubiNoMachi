/* 53-dungeon.js — 副本：独立场景切换
 *
 * 【设计】
 * 副本不是大地图上围一块区域，而是**整体换掉 G.world.scene**：
 *   进入 -> 保存大地图场景引用 -> 构建副本场景 -> G.world.scene = 新场景
 *   离开 -> G.world.scene = 保存的场景 -> 清理副本里的实体
 *
 * 之所以敢这么做：全项目对场景的引用都是走 `G.world.scene`（13 处，
 * 渲染循环也每帧重新读），没有缓存场景引用的地方。所以换引用是安全的。
 *
 * 【房间推进】
 * 每个房间是矩形区域，玩家清光该房间的敌人后，通往下一间的门打开。
 * 最后是 Boss 房，击败 Boss 后出现离开的传送门。
 *
 * 【为什么不用真正的多场景资源加载】
 * 单文件交付（game.html）+ file:// 约束下，没有按需加载的概念。
 * 副本场景是**程序化即时生成**的，进入时构建、离开时丢弃，
 * 所以内存不会累积。
 */
(function (G) {
  'use strict';

  var D = G.dungeon = {};

  // 当前状态
  D.active = false;
  D.data = null;            // 副本定义（G.DATA.DUNGEONS 里的一项）
  D.roomIndex = 0;
  D.cleared = {};           // roomId -> true（该房间已清）
  D.savedScene = null;      // 大地图场景引用
  D.savedPlayerPos = null;
  D.roomEnemies = {};       // roomId -> [enemy]
  D.exitPortal = null;
  D.walls = [];

  // =====================================================================
  // 进入 / 离开
  // =====================================================================

  /**
   * 进入副本。
   * @param {string} dungeonId 例如 'wasureo'
   * @returns {boolean}
   */
  D.enter = function (dungeonId) {
    if (D.active) return false;
    var data = (G.DATA.DUNGEONS || {})[dungeonId];
    if (!data) {
      G.ui.toast('（这个地方还没有探明）', 2200);
      return false;
    }

    // 保存大地图现场
    D.savedScene = G.world.scene;
    var st = G.player.state;
    D.savedPlayerPos = { x: st.x, z: st.z };
    D.savedTimeOfDay = G.world.timeOfDay;

    // 清掉大地图上的实体（敌人/掉落/投射物），避免它们跨场景残留
    // 注意：不清 props（那是大地图的一部分，场景切回来还要用）
    D._clearTransientEntities();

    // 构建副本场景
    D.data = data;
    D.active = true;
    D.cleared = {};
    D.roomEnemies = {};
    D.roomIndex = 0;

    G.world.inDungeon = true;
    G.world.scene = D._buildScene(data);

    // 玩家放到第一间房的入口
    var r0 = data.rooms[0];
    st.x = r0.x;
    st.z = r0.z + r0.d / 2 - 2.5;
    st.vx = 0; st.vz = 0;
    st.hp = st.maxHp;

    // 相机立刻跟过去（避免从旧位置插值过来）
    if (G.camera && G.camera.follow) {
      G.camera.follow.x = st.x;
      G.camera.follow.z = st.z;
      G.camera.follow.y = 0.6;
      if (G.camera.snap) G.camera.snap();
    }

    G.ui.toast('—— ' + data.name + ' ——', 2600);
    G.bus.emit('dungeon:enter', dungeonId);
    D._spawnRoom(0);
    return true;
  };

  /** 离开副本，回到大地图 */
  D.leave = function () {
    if (!D.active) return false;

    D._clearTransientEntities();
    // 丢弃副本场景（three.js 的几何体会随引用消失被 GC）
    D._disposeScene(G.world.scene);

    G.world.scene = D.savedScene;
    G.world.inDungeon = false;

    var st = G.player.state;
    if (D.savedPlayerPos) {
      st.x = D.savedPlayerPos.x;
      st.z = D.savedPlayerPos.z;
    }
    st.vx = 0; st.vz = 0;

    if (G.camera && G.camera.follow) {
      G.camera.follow.x = st.x;
      G.camera.follow.z = st.z;
      if (G.camera.snap) G.camera.snap();
    }

    D.active = false;
    D.data = null;
    D.exitPortal = null;
    D.roomEnemies = {};
    D.cleared = {};

    G.ui.toast('—— 回到了外面 ——', 2200);
    G.bus.emit('dungeon:leave');
    return true;
  };

  // =====================================================================
  // 场景构建
  // =====================================================================

  D._buildScene = function (data) {
    var scene = new THREE.Scene();
    // 背景色用「比地面略暗的紫」而不是纯深蓝：
    // 地面若因面积不足露出边缘，背景与地面同色系时不会突兀。
    scene.background = new THREE.Color('#2E2844');
    scene.fog = new THREE.Fog(new THREE.Color('#2E2844'), 70, 180);

    // ---- 光照 ----
    // 【关键：Toon 材质的暗部靠 HemisphereLight 提亮，不是 AmbientLight】
    //
    // 第一次做的时候用了 Ambient 0.42 + Directional 1.15，结果：
    //   - 墙全黑（纯剪影）、地面深紫接近不可见、背景色从地面外漏出来
    // 原因与大地图那个坑完全相同：AmbientLight 只给一个常数项，
    // 对 MeshToonMaterial 的阶梯暗部几乎不起作用，背光面直接被压死。
    // 必须用 HemisphereLight（天空色打顶 + 地面色打底）才能把暗部提起来。
    var amb = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(amb);
    var hemi = new THREE.HemisphereLight(0x9AAED0, 0x3A3450, 0.95);
    scene.add(hemi);

    // 主光：从上方斜照，带阴影
    var key = new THREE.DirectionalLight(0xD8E4F4, 1.5);
    key.position.set(12, 26, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    var sd = 50;
    key.shadow.camera.left = -sd;
    key.shadow.camera.right = sd;
    key.shadow.camera.top = sd;
    key.shadow.camera.bottom = -sd;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 100;
    scene.add(key);

    // 每间房中央一盏冷光，营造"被照亮的一小块"的感觉
    data.rooms.forEach(function (room) {
      var lamp = new THREE.PointLight(0xA8C4E0, 1.1, Math.max(room.w, room.d) * 1.4, 2);
      lamp.position.set(room.x, 4.5, room.z);
      scene.add(lamp);
    });

    // ---- 地面与墙 ----
    D.walls = [];
    D._buildRooms(scene, data);

    return scene;
  };

  D._buildRooms = function (scene, data) {
    // 找到整个副本的包围范围
    var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    data.rooms.forEach(function (r) {
      minX = Math.min(minX, r.x - r.w / 2);
      maxX = Math.max(maxX, r.x + r.w / 2);
      minZ = Math.min(minZ, r.z - r.d / 2);
      maxZ = Math.max(maxZ, r.z + r.d / 2);
    });

    // 地面：一整块深色石地（覆盖所有房间 + 连接走廊）
    // 【配色经验】Toon 材质的暗部会把颜色再压暗一档，
    // 所以这里不能用"看起来刚好"的中灰，要往亮里提一档。
    // 第一版用 #3A3450 / #4A4260，渲染出来接近纯黑，完全看不出地面。
    //
    // 【面积要留足】正交相机在 45° 偏航下可见范围约 30 单位，
    // 而副本最窄处只有 12 单位宽。地面如果只贴着房间铺，
    // 画面四周会露出背景色（看起来像浮在虚空里）。
    // 所以额外留 OUTER 的余量。
    var OUTER = 26;
    var pad = 6 + OUTER;
    var gw = (maxX - minX) + pad * 2;
    var gd = (maxZ - minZ) + pad * 2;
    var gcx = (minX + maxX) / 2;
    var gcz = (minZ + maxZ) / 2;

    var floorGeo = new THREE.PlaneGeometry(gw, gd, 1, 1);
    floorGeo.rotateX(-Math.PI / 2);
    var floorMat = G.celMaterial('#6A6188', {
      steps: 3, darkness: 0.9,
      map: G.texCached('stoneBrick', '#6A6188', {})
    });
    var floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(gcx, 0, gcz);
    floor.receiveShadow = true;
    scene.add(floor);

    // 每个房间：铺一层略亮的地板，做出"房间"的区分
    data.rooms.forEach(function (r) {
      var rg = new THREE.PlaneGeometry(r.w, r.d);
      rg.rotateX(-Math.PI / 2);
      var rm = G.celMaterial('#8078A8', {
        steps: 3, darkness: 0.88,
        map: G.texCached('stoneBrick', '#8078A8', {})
      });
      var mesh = new THREE.Mesh(rg, rm);
      mesh.position.set(r.x, 0.02, r.z);
      mesh.receiveShadow = true;
      scene.add(mesh);
    });

    // 墙：沿房间边界立起，用碰撞体挡住玩家
    //
    // 【墙高必须配合俯视角度】
    // 等距相机俯角 35°、距离 34，如果墙高 5.0，站在房间南侧时
    // 南墙会把玩家和 Boss 完全挡住——截图里能看到血条、看不到人。
    // 实测：玩家 NDC 在屏幕正中且 inFrustum=true，但画面里是墙。
    // 改成 2.6：仍有"围合感"，但不挡视线（2.6 在 35° 俯视下
    // 只遮住物体底部约 1/3）。
    var wallH = 2.6;
    var wallColor = '#5A5278';

    function addWall(x, z, w, d, rotY) {
      var geo = new THREE.BoxGeometry(w, wallH, d);
      var mat = G.celMaterial(wallColor, {
        steps: 3, darkness: 0.85,
        map: G.texCached('stoneBrick', wallColor, {})
      });
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, wallH / 2, z);
      if (rotY) m.rotation.y = rotY;
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);

      // 碰撞体（用现有的 circle collider 近似，每个墙段打几个点）
      var half = Math.max(w, d) / 2;
      var steps = Math.max(1, Math.ceil(Math.max(w, d) / 2));
      for (var i = 0; i <= steps; i++) {
        var t = steps === 0 ? 0 : (i / steps - 0.5);
        var px = x + (w > d ? t * w : 0);
        var pz = z + (d > w ? t * d : 0);
        G.world.addCircleCollider(px, pz, 0.9);
      }
      D.walls.push(m);
    }

    // 外墙：围住整个副本范围
    addWall(gcx, minZ - pad + 1, gw, 2);
    addWall(gcx, maxZ + pad - 1, gw, 2);
    addWall(minX - pad + 1, gcz, 2, gd);
    addWall(maxX + pad - 1, gcz, 2, gd);

    // 房间之间：只做"侧墙"，中间留通道
    // 每间房的左右两侧各一道短墙
    data.rooms.forEach(function (r) {
      addWall(r.x - r.w / 2, r.z, 1.6, r.d * 0.7);
      addWall(r.x + r.w / 2, r.z, 1.6, r.d * 0.7);
    });

    // 房间之间的连接走廊：短墙留出通道感
    for (var i = 0; i < data.rooms.length - 1; i++) {
      var a = data.rooms[i], b = data.rooms[i + 1];
      var midZ = (a.z + b.z) / 2;
      var halfGap = Math.abs(a.z - b.z) / 2;
      addWall(a.x - 2.6, midZ, 1.4, halfGap);
      addWall(a.x + 2.6, midZ, 1.4, halfGap);
    }
  };

  D._disposeScene = function (scene) {
    if (!scene) return;
    scene.traverse(function (o) {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
        // 材质是共享缓存的不 dispose，避免影响大地图
      }
    });
  };

  D._clearTransientEntities = function () {
    // 敌人
    if (G.enemy && G.enemy.list) {
      G.enemy.list.forEach(function (e) {
        if (e.mesh && e.mesh.parent) e.mesh.parent.remove(e.mesh);
        if (e.shadow && e.shadow.parent) e.shadow.parent.remove(e.shadow);
        if (e.hpBar && e.hpBar.mesh && e.hpBar.mesh.parent) e.hpBar.mesh.parent.remove(e.hpBar.mesh);
      });
      G.enemy.list.length = 0;
    }
    // 掉落
    if (G.loot && G.loot.drops) {
      G.loot.drops.forEach(function (d) {
        if (d.group && d.group.parent) d.group.parent.remove(d.group);
      });
      G.loot.drops.length = 0;
    }
    // 投射物 / 特效
    if (G.projectiles && G.projectiles.clear) G.projectiles.clear();
    if (G.fx && G.fx.clear) G.fx.clear();
  };

  // =====================================================================
  // 房间推进
  // =====================================================================

  D._spawnRoom = function (idx) {
    var room = D.data.rooms[idx];
    if (!room) return;
    D.roomIndex = idx;

    // 【清掉这个房间之前的记录】
    // 否则重复进入同一间（比如外部代码再次调用 _spawnRoom）时，
    // roomEnemies 里留着旧的（已死的）敌人数组，update 会立刻判定"已清空"，
    // 导致误开出口 / 误推进。
    D.roomEnemies[room.id] = null;
    delete D.cleared[room.id];

    // 【玩家也要移到新房间的入口】
    //
    // 踩过的坑：第一版只刷怪、不移动玩家。结果是玩家站在上一间房，
    // Boss 刷在几十单位外的下一间房 —— 画面上只看到血条飘在屏幕顶部，
    // 看不到 Boss，而且玩家还得自己走过去（穿过墙）。
    // 所以推进房间时把玩家一起送进去，落在房间南侧入口处。
    var st = G.player && G.player.state;
    if (st) {
      st.x = room.x;
      st.z = room.z + room.d / 2 - 2.5;
      st.vx = 0; st.vz = 0;
      if (G.camera && G.camera.follow) {
        G.camera.follow.x = st.x;
        G.camera.follow.z = st.z;
        G.camera.follow.y = 0.6;
        if (G.camera.snap) G.camera.snap();
      }
    }

    // Boss 房
    if (room.boss) {
      // Boss 生成在房间**北侧中央**，玩家在南侧入口。
      //
      // 踩过两次：
      //   1) 生成在 room.z - 2 时离玩家只有 0.5 单位，Boss 体型大把玩家糊住
      //   2) 生成在 room.z - d/2 + 4 时贴到了北墙，和墙重叠
      // 取房间纵向 1/4 处，既远离玩家也不贴墙。
      var bossZ = room.z - room.d / 4;
      var boss = G.enemy.spawn(room.boss, room.x, bossZ, null);
      if (boss) {
        D.roomEnemies[room.id] = [boss];
        G.fx.impactRing(room.x, bossZ, 5.0, '#D9A0E8');
        G.ui.toast('—— ' + (boss.def.name || '何か') + ' 出现了 ——', 2800);
        G.bus.emit('sfx', 'skill_unlock');
        if (G.camera.shakeAdd) G.camera.shakeAdd(0.8, 0.6);
      }
      return;
    }

    // 普通房：按配置刷怪
    var list = [];
    (room.enemies || []).forEach(function (cfg) {
      for (var i = 0; i < cfg.count; i++) {
        var ang = Math.random() * Math.PI * 2;
        var rad = 2 + Math.random() * (Math.min(room.w, room.d) / 2 - 3);
        var ex = room.x + Math.cos(ang) * rad;
        var ez = room.z + Math.sin(ang) * rad;
        var e = G.enemy.spawn(cfg.id, ex, ez, null);
        if (e) list.push(e);
      }
    });
    D.roomEnemies[room.id] = list;
    if (list.length) {
      G.ui.toast(room.name + ' —— 清掉它们', 2200);
    }
  };

  /** 每帧调用：检查当前房间是否清空，清空则推进 */
  D.update = function (dt, player) {
    if (!D.active || !D.data) return;

    var room = D.data.rooms[D.roomIndex];
    if (!room) return;

    var enemies = D.roomEnemies[room.id];

    // 【健壮性】如果这个房间还没记录过敌人列表，说明状态不一致
    // （例如被外部代码直接 _spawnRoom 跳过、或读档后恢复）。
    // 这种情况下不判定"已清空"，而是补一次刷怪，避免误开出口。
    if (!enemies) {
      D._spawnRoom(D.roomIndex);
      return;
    }

    var alive = enemies.filter(function (e) { return e && !e.dead; }).length;

    if (alive === 0 && !D.cleared[room.id]) {
      D.cleared[room.id] = true;
      if (room.boss) {
        G.ui.toast('—— 它回去了。——', 3000);
        D._openExit(player);
      } else {
        G.ui.toast(room.name + ' 清空了', 2000);
        if (D.roomIndex + 1 < D.data.rooms.length) {
          var nextIdx = D.roomIndex + 1;
          setTimeout(function () {
            if (D.active && G.dungeon.roomIndex === nextIdx - 1) {
              D._spawnRoom(nextIdx);
            }
          }, 1400);
        }
      }
    }
  };

  /** 生成离开副本的传送门 */
  D._openExit = function (player) {
    if (D.exitPortal) return;
    var room = D.data.rooms[D.roomIndex];
    var g = new THREE.Group();

    // 光柱
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#8FE8C0'),
      transparent: true, opacity: 0.35,
      side: THREE.DoubleSide, depthWrite: false
    });
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(3, 5), mat);
    plane.position.y = 2.5;
    g.add(plane);

    var ring = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.8, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#8FE8C0'), transparent: true, opacity: 0.7,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);

    // 【位置必须远离玩家出生点】
    //
    // 踩过的坑：第一版把出口放在 room.z + d/2 - 3，而玩家进房间时
    // 就站在 room.z + d/2 - 2.5 —— 两者相距 0.5 单位。
    // 结果 Boss 一死、出口一开，下一帧玩家就被判定"站在出口里"，
    // 立刻被传送出副本，根本来不及看到"门开了"这件事。
    //
    // 改放在房间中央（Boss 倒下的位置附近），玩家必须自己走过去。
    var exitZ = room.z;
    g.position.set(room.x, 0, exitZ);
    G.world.scene.add(g);

    D.exitPortal = {
      group: g, x: g.position.x, z: g.position.z, radius: 2.2
    };

    G.ui.toast('一道光亮的门开了。走进去离开。', 3600);
  };

  /** 玩家是否站在出口里 */
  D.atExit = function (player) {
    if (!D.exitPortal) return false;
    var dx = player.x - D.exitPortal.x;
    var dz = player.z - D.exitPortal.z;
    return (dx * dx + dz * dz) < (D.exitPortal.radius * D.exitPortal.radius);
  };

  /** 当前房间信息（供 UI） */
  D.currentRoom = function () {
    if (!D.active || !D.data) return null;
    return D.data.rooms[D.roomIndex] || null;
  };

  /** 进度摘要 */
  D.progress = function () {
    if (!D.active || !D.data) return null;
    var total = D.data.rooms.length;
    var cleared = 0;
    D.data.rooms.forEach(function (r) { if (D.cleared[r.id]) cleared++; });
    return { cleared: cleared, total: total, name: D.data.name };
  };

})(window.G = window.G || {});
