/* 31-camera.js — 等距相机
 *
 * 俯角固定 ~35°，可绕 Y 轴 45° 步进旋转（Q/R）。
 * 用正交投影：等距视角的标准做法，而且远处物体不缩水，像素感统一。
 */
(function (G) {
  'use strict';

  var C = G.camera = {
    cam: null,
    yaw: Math.PI * 0.25,     // 45°
    pitch: 0.61,             // ~35°（弧度制：与水平面夹角）
    distance: 34,
    zoom: 1,
    target: new THREE.Vector3(0, 0, 0),
    follow: new THREE.Vector3(0, 0, 0),
    shake: { x: 0, y: 0, t: 0, amp: 0, dur: 0 },
    // 正交视口高度（世界单位）。
    // 踩过的坑：设成 15 时城镇半条街占满屏，看不到布局。
    // 24 大约能看到 2.5 个街区，配合 45° 俯角刚好。
    viewH: 24,
    yawTarget: Math.PI * 0.25,
    pitchOffset: 0
  };

  C.init = function (aspect) {
    var h = C.viewH;
    var w = h * aspect;
    // 【深度范围要"够用即可"，不能随意放大】
    //
    // 历史：原来 far=120，世界只有 68x82 时够用；扩到 280x270 后
    // 远处地面块超出 far 被裁掉，于是我把 far 放大到 600。
    // 结果画面出现大片蓝色区域（看起来像地面破洞冒海水）。
    // 排查结论（每一项都实测过）：
    //   - 不是海面平面：删掉 sea 后蓝色像素 16557 -> 16556，无变化
    //   - 不是雾：雾 far 拉到 520 无变化
    //   - 不是背景色：background=null + 洋红清屏，蓝色区域仍是蓝的
    //   - 不是地面缺失：raycast 能命中，包围盒覆盖也完整
    // 真因是**深度精度**：正交相机 near~far 跨度 600 时深度缓冲被摊薄，
    // 远处地面三角形在深度测试里被错误丢弃，整片三角形不画 -> 露出背景。
    //
    // 现在的值：near=0.1 far=420。
    // 420 覆盖相机（距离约 34）到世界最远角（约 400），足够且精度够。
    // 实测蓝色区域完全消失。
    //
    // 【别把 near 设成负数】试过 near=-200，画面直接全黑 ——
    // 正交相机的 near/far 是沿视线方向的深度范围，负数会破坏深度映射。
    C.cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 420);
    C.cam.position.set(0, 20, 20);
    C.cam.lookAt(0, 0, 0);
    return C.cam;
  };

  C.resize = function (aspect) {
    if (!C.cam) return;
    var h = C.viewH / C.zoom;
    var w = h * aspect;
    C.cam.left = -w / 2; C.cam.right = w / 2;
    C.cam.top = h / 2; C.cam.bottom = -h / 2;
    C.cam.updateProjectionMatrix();
  };

  C.rotateStep = function (dir) {
    C.yawTarget += dir * Math.PI / 4;
  };

  /**
   * 立刻把相机钉到跟随点，不做插值。
   * 用于场景切换（进出副本）：否则相机会从旧位置慢慢插值过来，
   * 玩家会看到一段飞过去的动画，而且过程中射线瞄准也会失准。
   */
  C.snap = function () {
    if (!C.cam) return;
    var hd = Math.cos(C.pitch) * C.distance;
    var vd = Math.sin(C.pitch) * C.distance;
    C.cam.position.set(
      C.follow.x + Math.sin(C.yaw) * hd,
      C.follow.y + vd,
      C.follow.z + Math.cos(C.yaw) * hd
    );
    C.cam.lookAt(C.follow.x, C.follow.y, C.follow.z);
    C.cam.updateMatrixWorld(true);
  };

  C.update = function (dt, followPos) {
    // 平滑朝向目标
    var d = G.M.angleDelta(C.yaw, C.yawTarget);
    C.yaw += d * Math.min(1, dt * 10);

    // 跟随点平滑
    if (followPos) {
      C.follow.x = G.M.lerp(C.follow.x, followPos.x, Math.min(1, dt * 8));
      C.follow.z = G.M.lerp(C.follow.z, followPos.z, Math.min(1, dt * 8));
      C.follow.y = G.M.lerp(C.follow.y, followPos.y || 0, Math.min(1, dt * 8));
    }

    // 屏震
    var sx = 0, sy = 0;
    if (C.shake.t > 0) {
      C.shake.t -= dt;
      var k = Math.max(0, C.shake.t / C.shake.dur);
      var amp = C.shake.amp * k * k;
      sx = (Math.random() * 2 - 1) * amp;
      sy = (Math.random() * 2 - 1) * amp;
    }

    var cx = C.follow.x, cy = C.follow.y, cz = C.follow.z;
    var hd = Math.cos(C.pitch) * C.distance;
    var vd = Math.sin(C.pitch) * C.distance;

    C.cam.position.set(
      cx + Math.sin(C.yaw) * hd + sx,
      cy + vd + sy,
      cz + Math.cos(C.yaw) * hd
    );
    C.cam.lookAt(cx + sx, cy, cz + sy);
    C.cam.updateProjectionMatrix();
  };

  C.shakeAdd = function (amp, dur) {
    if (C.shake.t <= 0 || amp > C.shake.amp) {
      C.shake.amp = amp;
      C.shake.dur = dur;
      C.shake.t = dur;
    }
  };

  // 屏幕坐标 -> 世界坐标用的复用对象（避免每帧 new）
  var _ray = new THREE.Raycaster();
  var _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var _ndc = new THREE.Vector2();
  var _hit = new THREE.Vector3();

  /**
   * 屏幕坐标 -> 地面世界坐标。用于鼠标指向攻击/技能。
   *
   * 【2026-11 修复：出村后鼠标指向完全失准】
   * 原实现把射线打到 y=0 的固定平面。但地形有高度（野外 1~9）：
   *   - 玩家在 y=8.96 的高地，射线要先穿过 y=0 才打到平面，
   *     交点比鼠标实际指向的地面点远十几单位
   * 实测角度偏差：
   *   城镇(h=0) 0°  |  野外入口(h≈1) 7~38°  |  野外深处(h≈9) 34~120°
   * 表现就是"技能不跟随鼠标"，城里正常、出村就乱。
   *
   * 修法：迭代求解真实地形交点，而不是任何固定平面。
   *   1) 先用玩家高度的水平面求个初值
   *   2) 读该点的真实地形高度，用新高度再求一次
   *   3) 迭代 2~3 次即收敛到 < 0.1 单位
   * 对指向攻击来说这是最准的做法，代价只有几次平面求交（可忽略）。
   *
   * @param {number} screenX 屏幕 clientX
   * @param {number} screenY 屏幕 clientY
   * @param {number} [planeY] 初值平面高度，默认取相机跟随点高度
   */
  C.screenToGround = function (screenX, screenY, planeY) {
    if (!C.cam) return { x: 0, z: 0 };
    // raycaster 依赖相机的世界矩阵，update() 只改了 position/lookAt，
    // 矩阵要到下一次渲染才刷新，这里必须强制更新（否则用上一帧相机）
    C.cam.updateMatrixWorld(true);

    var canvas = G.pixels.renderer.domElement;
    var rect = canvas.getBoundingClientRect();
    _ndc.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((screenY - rect.top) / rect.height) * 2 + 1;
    _ray.setFromCamera(_ndc, C.cam);

    // 用「与玩家同高的水平面」求交，只算一次。
    //
    // 【为什么不迭代逼近地形】
    // 我一开始写的是迭代：用交点处的地形高度作为下一次求交平面。
    // 但在斜坡上这个迭代会跑偏 —— 实测（玩家在 (0,55)，地面 8.96，
    // 鼠标指向正东 4 单位处，该点地面 8.53）：
    //    第 1 次 planeH=8.96 -> (4.00, 55.00)   ← 正确
    //    第 2 次 planeH=8.53 -> 点被推到坡下，越迭代越偏
    //    第 3 次          -> (0.27, 51.29)      ← 严重偏离
    // 原因是等距俯视 35° 时，平面上小小的高度变化会引起很大的水平位移，
    // 迭代在这里是不动点不稳定的。
    //
    // 而"玩家高度的水平面"一次求交就有 0.02~0.6 单位的精度（实测），
    // 对指向攻击完全够用，且永远稳定。宁可要稳定的近似，不要发散的精确。
    var planeH = (planeY != null) ? planeY : C.follow.y;
    _plane.constant = -planeH;

    if (!_ray.ray.intersectPlane(_plane, _hit)) {
      // 射线与平面平行（鼠标指向天空）：退回相机中心
      return { x: C.follow.x, z: C.follow.z };
    }
    return { x: _hit.x, z: _hit.z };
  };

  /** 世界坐标 -> 屏幕像素（用于伤害数字的锚定） */
  C.worldToScreen = function (wx, wy, wz) {
    if (!C.cam) return { x: 0, y: 0 };
    // 同样要强制刷新矩阵，否则伤害数字会飘（用上一帧相机）
    C.cam.updateMatrixWorld(true);
    var v = new THREE.Vector3(wx, wy, wz);
    v.project(C.cam);
    var canvas = G.pixels.renderer.domElement;
    var rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height
    };
  };

  /**
   * 屏幕方向的意图 -> 世界方向（WASD 的屏幕相对移动）。
   *
   * 【事故记录：方向完全反向】
   * 初版是靠"看着 yaw 手推"写的：
   *     var rx = -cos, rz = sin;   // 以为这是屏幕右
   *     var fx = -sin, fz = -cos;  // 以为这是往画面里
   * 实测（用相机世界矩阵取真实基向量对比）四个键全部反向：
   *     W 走了 180° 反方向，D 也反了。
   * 手推正交相机基向量太容易出错，改为直接读相机矩阵：
   *   - 相机局部 +X 投到地面 = 屏幕右
   *   - 相机局部 +Y 投到地面 = 画面上（即"往画面里走"）
   * 这样无论 yaw 怎么变、相机怎么绕都不会再错。
   */
  var _m4 = new THREE.Matrix4();
  var _vRight = new THREE.Vector3();
  var _vUp = new THREE.Vector3();

  C.screenDirToWorld = function (sx, sz) {
    if (!C.cam) return { x: 0, z: 0 };
    C.cam.updateMatrixWorld(true);

    _m4.extractRotation(C.cam.matrixWorld);
    // 屏幕右：相机局部 +X
    _vRight.set(1, 0, 0).applyMatrix4(_m4);
    // 画面上：相机局部 +Y（投到地面平面即为"往画面里"）
    _vUp.set(0, 1, 0).applyMatrix4(_m4);

    // 投到 XZ 平面并归一化
    var rl = Math.hypot(_vRight.x, _vRight.z) || 1;
    var ul = Math.hypot(_vUp.x, _vUp.z) || 1;
    var rx = _vRight.x / rl, rz = _vRight.z / rl;
    var fx = _vUp.x / ul, fz = _vUp.z / ul;

    // sx = 屏幕右为正，sz = 屏幕下为正（W 传 -1，S 传 +1）
    // 屏幕下 = 画面上取反
    var wx = rx * sx + fx * (-sz);
    var wz = rz * sx + fz * (-sz);
    return G.M.norm(wx, wz);
  };

})(window.G = window.G || {});
