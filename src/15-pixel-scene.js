/* 15-pixel-scene.js — 俯视像素场景构建（切片版）
 *
 * 【这是什么】
 * 把现有世界里"斜视角才成立"的 3D 物件，换成**俯视贴图平面**。
 *
 * 【为什么是"切片"】
 * 完整重写 4400 行风险太大。这一版只搭一个可玩的小场景，
 * 让用户先看观感：地面瓦片 + 房子 + 树 + 鸟居 + 灯笼 + 玩家 + 一只怪。
 * 观感确认后再铺开到真实世界。
 *
 * 【核心手法】
 * 全部用 `PlaneGeometry + 俯视贴图`，平铺在地面上（rotation.x = -PI/2）。
 * 不用 3D 几何体 —— 正俯视下 3D 体的侧面完全看不到，纯属浪费。
 */
(function (G) {
  'use strict';

  var PS = G.pixelScene = {};

  /** 建立切片场景，替换 G.world.scene */
  PS.buildSlice = function () {
    var PA = G.pixelArt;
    if (!PA) { console.error('[pixelScene] pixelArt 未加载'); return null; }

    var scene = new THREE.Scene();
    scene.background = new THREE.Color('#6E8F4C');

    // 正俯视不需要复杂光照：用环境光保证贴图原色
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    var W = 60, D = 44;   // 切片地图尺寸（世界单位）

    // ---------------- 地面：瓦片拼贴 ----------------
    //
    // 每个瓦片 2 世界单位。用 InstancedMesh 会失去单块贴图差异，
    // 这里瓦片数量可控（30×22=660），直接画。
    var TILE = 2;
    var tilesX = Math.floor(W / TILE);
    var tilesZ = Math.floor(D / TILE);

    var grassTex = [PA.grassTexture(0), PA.grassTexture(1), PA.grassTexture(2)];
    var dirtTex = [PA.dirtTexture(0), PA.dirtTexture(1)];

    var tileGeo = new THREE.PlaneGeometry(TILE, TILE);
    tileGeo.rotateX(-Math.PI / 2);

    for (var tz = 0; tz < tilesZ; tz++) {
      for (var tx = 0; tx < tilesX; tx++) {
        var wx = -W / 2 + tx * TILE + TILE / 2;
        var wz = -D / 2 + tz * TILE + TILE / 2;

        // 中间走一条土路（沿 z 轴）
        var isRoad = Math.abs(wx) < 3;
        var tex = isRoad
          ? dirtTex[(tx + tz) % dirtTex.length]
          : grassTex[(tx * 7 + tz * 13) % grassTex.length];

        var mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: false
        });
        var mesh = new THREE.Mesh(tileGeo, mat);
        mesh.position.set(wx, 0, wz);
        scene.add(mesh);
      }
    }

    // ---------------- 房子 ----------------
    //
    // 用俯视贴图贴在地面上，稍微抬高一点避免和地面 z-fighting。
    // PlaneGeometry 的宽高对应"屋顶的俯视投影"。
    var houses = [
      { x: -14, z: 2, w: 5, d: 4, opt: { roof: '#B0392E', noren: '#D9483B' } },
      { x: 14, z: 3, w: 4.5, d: 3.5, opt: { roof: '#9A5A4A', noren: '#7FB8D8' } },
      { x: -13, z: -8, w: 4, d: 3.5, opt: { roof: '#A8483A', noren: '#9CB87A' } },
      { x: 13.5, z: -7, w: 5, d: 4, opt: { roof: '#8E3A30', noren: '#E8C25A' } }
    ];
    houses.forEach(function (h) {
      var tex = PA.houseTexture(h.w, h.d, h.opt);
      // 【竖直站立，不平铺】
      // 62° 斜俯视下，平铺的贴片会被压成极扁的一条，几乎看不见。
      // 竖起来才能既看到屋顶（因为俯视）又看到正面墙。
      var pw = h.w * 2.0;
      var ph = (h.d * 16 + 8) / 16 * 2.0;
      var geo = new THREE.PlaneGeometry(pw, ph);
      var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(h.x, ph / 2, h.z);
      scene.add(mesh);
    });

    // ---------------- 树 ----------------
    var treeSeeds = [1, 2, 3, 4, 5, 6, 7, 8];
    var treePos = [
      [-22, 14], [-16, 16], [16, 15], [22, 12],
      [-24, -4], [24, -2], [-8, 18], [10, -18]
    ];
    treePos.forEach(function (p, i) {
      var tex = PA.treeTexture(treeSeeds[i], {});
      // 【竖直站立】同理：平铺的树冠在 62° 下会压成椭圆贴片
      var size = 4.2;
      var geo = new THREE.PlaneGeometry(size, size);
      var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p[0], size / 2, p[1]);
      scene.add(mesh);

      // 树影（这个要平铺在地面）
      var shGeo = new THREE.PlaneGeometry(3.0, 3.0);
      shGeo.rotateX(-Math.PI / 2);
      var shMat = new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.18
      });
      var sh = new THREE.Mesh(shGeo, shMat);
      sh.position.set(p[0] + 0.8, 0.09, p[1] + 0.8);
      scene.add(sh);
    });

    // ---------------- 鸟居 ----------------
    var toriiW = 7, toriiH = 5;
    var toriiGeo = new THREE.PlaneGeometry(toriiW, toriiH);
    var toriiMesh = new THREE.Mesh(toriiGeo, new THREE.MeshBasicMaterial({
      map: PA.toriiTexture(), transparent: true
    }));
    toriiMesh.position.set(0, toriiH / 2, 12);
    scene.add(toriiMesh);

    // ---------------- 灯笼 ----------------
    var lanternTex = PA.lanternTexture();
    [[-4, 8], [4, 8], [-4, 2], [4, 2], [-4, -4], [4, -4]].forEach(function (p) {
      var s = 2.2;
      var geo = new THREE.PlaneGeometry(s, s);
      var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: lanternTex, transparent: true
      }));
      mesh.position.set(p[0], s / 2, p[1]);
      scene.add(mesh);
    });

    // ---------------- 角色：玩家 ----------------
    var playerSheet = PA.charTexture({
      kimono: '#5A8AC8', kimonoSh: '#3A6AA8',
      hair: '#3B2E36', hairSh: '#2A1F26',
      obi: '#E8C25A', skin: '#FCE0CE'
    });
    var playerMesh = PS._makeCharacterMesh(playerSheet);
    scene.add(playerMesh);

    // ---------------- 角色：NPC ----------------
    var npcSheet = PA.charTexture({
      kimono: '#F7C8D8', kimonoSh: '#D9A0B8',
      hair: '#6B4A3A', hairSh: '#4A3025',
      obi: '#7FB069', skin: '#FCE0CE'
    });
    var npcMesh = PS._makeCharacterMesh(npcSheet);
    npcMesh.position.set(3, 0.5, 8);
    scene.add(npcMesh);

    // ---------------- 敌人 ----------------
    var enemyMesh = PS._makeEnemyMesh(PA.enemyTexture('onibi'));
    enemyMesh.position.set(-6, 0.4, -6);
    scene.add(enemyMesh);

    // 返回切片里的对象引用，供动画使用
    PS._slice = {
      scene: scene,
      playerMesh: playerMesh,
      playerSheet: playerSheet,
      npcMesh: npcMesh,
      npcSheet: npcSheet,
      enemyMesh: enemyMesh
    };

    return scene;
  };

  /** 造一个角色 billboard（4 方向 × 4 帧） */
  PS._makeCharacterMesh = function (sheet) {
    var PA = G.pixelArt;
    var W = PA.FRAME_W, H = PA.FRAME_H;
    var geo = new THREE.PlaneGeometry(W / 8, H / 8);   // 16×24 px → 2×3 世界单位

    // 【每个角色必须有独立的贴图对象】
    // 因为切帧是靠改 texture.repeat/offset 实现的，而 THREE 的贴图是
    // 按对象共享的 —— 两个角色共用一份贴图时，一个切帧另一个也跟着变。
    // 所以这里 clone 一份。
    var tex = sheet.clone();
    tex.needsUpdate = true;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;

    var mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.userData.baseSheet = sheet;
    mesh.userData.dir = 0;
    mesh.userData.frame = 0;
    PS._setCharFrame(mesh, 0, 0);
    mesh.position.y = H / 16;   // 脚踩地面
    return mesh;
  };

  /** 设置角色当前方向与帧 */
  PS._setCharFrame = function (mesh, dir, frame) {
    var PA = G.pixelArt;
    var tex = mesh.material && mesh.material.map;
    if (!tex) return;

    // 【必须设 ClampToEdgeWrapping】
    // 用 repeat/offset 切帧时，如果 wrap 是默认的 RepeatWrapping，
    // 采样会跨过边缘取到相邻帧的像素，表现为角色身上出现横向错位条纹。
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    tex.repeat.set(1 / PA.FRAMES, 1 / PA.DIRS);
    // 图集里第 0 行在最上方，而 UV 的 v=0 在下方，所以要倒过来
    tex.offset.set(frame / PA.FRAMES, 1 - (dir + 1) / PA.DIRS);

    mesh.userData.dir = dir;
    mesh.userData.frame = frame;
  };

  /** 敌人：单个平面贴图 */
  PS._makeEnemyMesh = function (tex) {
    var geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);      // 敌人平铺在地面（俯视看是个圆形）
    var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    var mesh = new THREE.Mesh(geo, mat);
    return mesh;
  };

  /**
   * 每帧更新切片里的角色动画。
   * 由主循环调用（若 slice 存在）。
   */
  PS.update = function (dt, playerState) {
    if (!PS._slice) return;
    var s = PS._slice;

    // 玩家：跟随真实坐标，方向按移动方向
    if (s.playerMesh && playerState) {
      s.playerMesh.position.x = playerState.x;
      s.playerMesh.position.z = playerState.z;

      // 4 方向
      if (G.pixelMode && G.pixelMode.dir4FromAngle) {
        var dir = G.pixelMode.dir4FromAngle(playerState.facing);
        // pixelMode 的 0=下 1=右 2=上 3=左
        // characterSheet 的 0=下 1=左 2=右 3=上
        var map = [0, 2, 3, 1];
        var sheetDir = map[dir];

        // 走路帧循环：静止用 0，移动时 1→2→3→2
        var moving = Math.abs(playerState.vx) + Math.abs(playerState.vz) > 0.1;
        PS._walkT = (PS._walkT || 0) + dt * 6;
        var frame = moving ? (Math.floor(PS._walkT) % 4) : 0;

        PS._setCharFrame(s.playerMesh, sheetDir, frame);
      }
    }

    // NPC 轻微上下浮动（呼吸感）
    if (s.npcMesh) {
      PS._npcT = (PS._npcT || 0) + dt * 2;
      s.npcMesh.position.y = 1.5 + Math.sin(PS._npcT) * 0.05;
    }

    // 敌人缓慢转圈（用旋转平面表现"游荡"）
    if (s.enemyMesh) {
      s.enemyMesh.rotation.y += dt * 0.8;
    }
  };

  /** 清理切片 */
  PS.clear = function () {
    PS._slice = null;
  };

})(window.G = window.G || {});
