/* 13-pixelmode.js — 像素风模式（RPG Maker 观感）
 *
 * 【为什么单独一个文件】
 * 用户希望把画风改成 RPG Maker 那种 2D 俯视像素风。
 * 但当前是 3D 等距（35° 斜俯视、可旋转、3D 地形高度），
 * 两者是根本不同的表现体系，一次性重写 4400 行风险太大。
 *
 * 所以先做成**可切换模式**：
 *   G.pixelMode.on()   正俯视 + 强制像素采样 + 瓦片化地面
 *   G.pixelMode.off()  回到原来的等距视角
 *
 * 这样能立刻看到观感差异，也方便随时回退。
 *
 * 【RPG Maker 风格的关键特征】
 *  1) **正俯视**（垂直向下看），不是斜俯视 —— 这是最根本的一条
 *  2) **相机不可旋转**，固定方向
 *  3) **瓦片网格**地面，边界清晰
 *  4) 角色是固定朝向像素精灵（正面/背面/左/右），不是 8 方向
 *  5) 物件也是平面贴图，不做 3D 立体
 */
(function (G) {
  'use strict';

  var PM = G.pixelMode = {
    enabled: false,
    // 保存切换前的相机参数，便于回退
    _saved: null
  };

  /** 一个瓦片在世界坐标里多大（RPG Maker 常用 48px，这里取 2 世界单位） */
  PM.TILE = 2;

  /**
   * 打开像素风模式。
   * 只改相机与采样方式，不动几何体 —— 先看观感。
   */
  PM.on = function () {
    if (PM.enabled) return;
    PM.enabled = true;

    var C = G.camera;
    PM._saved = {
      pitch: C.pitch,
      yaw: C.yaw,
      yawTarget: C.yawTarget,
      distance: C.distance,
      viewH: C.viewH,
      pitchOffset: C.pitchOffset
    };

    // ---- 1. 「假俯视」而不是纯正俯视 ----
    //
    // 【关键发现】第一版设成 90°（垂直向下）后，玩家和 NPC 全部消失 ——
    // 因为角色是竖直的 billboard 平面，从正上方看就是一条线。
    //
    // 但真正的 RPG Maker 也不是纯正俯视：
    // 它的角色图是**预先画成"从高处俯视但能看到正脸"**的小人，
    // 也就是美术层面已经做了 3/4 视角，相机才能是纯 2D。
    //
    // 我们在 3D 里没法凭空造出那种美术，所以用 62° 斜俯视：
    //   - 角色 billboard 仍然可见（能看到脸和身子）
    //   - 地面看起来足够"从上往下"，瓦片感成立
    //   - 这是 Octopath / 很多 HD-2D 游戏的做法
    C.pitch = 62 * Math.PI / 180;
    C.pitchOffset = 0;
    C.distance = 40;
    // 【视野】用素材包时，32px 瓦片 = 2 世界单位，
    // 一栋 8×6 格的房子就是 16×12 世界单位。
    // viewH=20 时它占半屏，看不全城镇布局。
    // 提到 34 大约能看 2 个街区，接近 RPG Maker 的取景。
    C.viewH = 34;

    // ---- 2. 相机不旋转 ----
    C.yaw = 0;
    C.yawTarget = 0;

    // ---- 3. 打标记：让其它模块知道现在是像素模式 ----
    if (G.world) {
      G.world.pixelMode = true;
      PM._applyGroundTiles();
    }

    C.resize(G.INTERNAL_W / G.INTERNAL_H);
    if (C.snap) C.snap();

    G.log && G.log('[pixelMode] on');
  };

  /** 关掉像素风模式，恢复等距视角 */
  PM.off = function () {
    if (!PM.enabled) return;
    PM.enabled = false;

    var C = G.camera;
    if (PM._saved) {
      C.pitch = PM._saved.pitch;
      C.yaw = PM._saved.yaw;
      C.yawTarget = PM._saved.yawTarget;
      C.distance = PM._saved.distance;
      C.viewH = PM._saved.viewH;
      C.pitchOffset = PM._saved.pitchOffset;
    }
    if (G.world) G.world.pixelMode = false;

    C.resize(G.INTERNAL_W / G.INTERNAL_H);
    if (C.snap) C.snap();

    G.log && G.log('[pixelMode] off');
  };

  PM.toggle = function () {
    if (PM.enabled) PM.off(); else PM.on();
    return PM.enabled;
  };

  /**
   * 正俯视时，相机不能转，所以角色朝向也要相应简化。
   *
   * 现在的 8 方向精灵依赖 camera.yaw 做映射；
   * 正俯视下 yaw 固定为 0，映射会退化成固定值。
   * 这里给出"像素风下应该用哪个方向"的映射：
   *   世界朝向 → 4 方向（上/下/左/右）
   */
  PM.dir4FromAngle = function (worldAngle) {
    // worldAngle 用 atan2(dx, dz)：0 = +z（屏幕下），PI/2 = +x（屏幕右）
    // RPG Maker 的 4 方向：下、左、右、上
    var a = worldAngle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;

    // 分四个象限，每个 90°
    if (a >= -Math.PI / 4 && a < Math.PI / 4) return 0;        // 下（+z）
    if (a >= Math.PI / 4 && a < Math.PI * 3 / 4) return 1;     // 右（+x）
    if (a >= Math.PI * 3 / 4 || a < -Math.PI * 3 / 4) return 2; // 上（-z）
    return 3;                                                   // 左（-x）
  };

  /** 像素模式下 4 方向对应的中文名（调试用） */
  PM.dir4Name = function (d) {
    return ['下', '右', '上', '左'][d] || '?';
  };

  // =====================================================================
  // 地面瓦片化（切片阶段：只叠一层网格线，验证观感）
  // =====================================================================

  /**
   * 在现有地面上叠一层瓦片网格线。
   *
   * 【为什么不直接重建地面】切片阶段先验证观感：
   * 如果网格线 + 正俯视就能带来 RPG Maker 的感觉，
   * 再去做真正的地块系统。
   */
  PM._applyGroundTiles = function () {
    if (!G.world || !G.world.scene) return;
    if (PM._gridLines) return;   // 已经加过

    var T = PM.TILE;
    var size = 120;              // 覆盖视野的网格范围
    var mat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#000000'),
      transparent: true,
      opacity: 0.10,
      depthWrite: false
    });

    var g = new THREE.Group();
    g.name = 'pixelGrid';

    // 沿 x 方向的线
    for (var i = -size / 2; i <= size / 2; i += T) {
      var geoX = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-size / 2, 0, i),
        new THREE.Vector3(size / 2, 0, i)
      ]);
      g.add(new THREE.Line(geoX, mat));
    }
    // 沿 z 方向的线
    for (var j = -size / 2; j <= size / 2; j += T) {
      var geoZ = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(j, 0, -size / 2),
        new THREE.Vector3(j, 0, size / 2)
      ]);
      g.add(new THREE.Line(geoZ, mat));
    }

    g.position.y = 0.03;   // 略高于地面，避免 z-fighting
    G.world.scene.add(g);
    PM._gridLines = g;
  };

})(window.G = window.G || {});
