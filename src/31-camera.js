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
    C.cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 120);
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

  /** 屏幕坐标 -> 地面(y=0) 世界坐标。用于鼠标指向技能。 */
  var _ray = new THREE.Raycaster();
  var _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var _ndc = new THREE.Vector2();
  var _hit = new THREE.Vector3();

  C.screenToGround = function (screenX, screenY) {
    if (!C.cam) return { x: 0, z: 0 };
    // 关键：raycaster 依赖相机的世界矩阵。update() 里只改了 position/lookAt，
    // 矩阵要到下一次渲染才刷新，这里必须手动强制更新，
    // 否则鼠标指向会用到上一帧的相机（踩过：攻击朝向差了 135°）
    C.cam.updateMatrixWorld(true);
    var canvas = G.pixels.renderer.domElement;
    var rect = canvas.getBoundingClientRect();
    _ndc.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((screenY - rect.top) / rect.height) * 2 + 1;
    _ray.setFromCamera(_ndc, C.cam);
    var out = _ray.ray.intersectPlane(_plane, _hit);
    if (!out) return { x: C.follow.x, z: C.follow.z };
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
