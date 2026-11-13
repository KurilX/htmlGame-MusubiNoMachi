/* 22-sprite.js — billboard 立绘运行时
 *
 * 职责：
 *  - atlas 缓存（同一个 look + 同一套动作只构建一次）
 *  - 每帧根据"相对相机的方向"选 8 方向帧
 *  - 动画状态机（idle/walk/attack/hurt/dead）
 *  - 落地阴影贴片（billboard 不投影，用椭圆贴片代替）
 */
(function (G) {
  'use strict';

  var S = G.sprite = {};

  // ---------- atlas 缓存 ----------
  var atlasCache = {};

  /**
   * 由 look 的实际内容生成缓存 key。
   *
   * 【踩过的超级大坑：缓存从未命中】
   * 原实现是：
   *     look.__key = 'L' + (++lookKeySeq) + ':' + parts.join(',');
   * key 里带了一个**自增序号**。而 G.makeLook(def.look) 每次调用都返回
   * 一个全新的对象，于是每只怪拿到的 key 都是新的 -> 缓存永远不命中 ->
   * **每刷一只怪都重新绘制整套图集（8 方向 × 13 帧的 canvas 绘制）**。
   *
   * 实测影响：
   *   - G.getChibiAtlas 单次 19ms（本该接近 0）
   *   - 刷一只怪 20~27ms
   *   - 走路时每 1~3 秒固定卡一次：因为 7 个刷怪区每 1.2 秒补一只，
   *     每次补员就是一次 20ms 的图集重绘（见 tools/_perf-walk.js 的帧记录）
   *
   * 修法：key 只由 look 的字段内容决定，去掉自增序号。
   * 同一个外观（同样字段值）必然得到同一个 key。
   */
  function lookKey(look) {
    if (look.__key) return look.__key;
    var parts = [];
    for (var k in look) {
      if (k === '__key') continue;
      parts.push(k + '=' + look[k]);
    }
    parts.sort();                                  // 字段顺序无关
    look.__key = 'L:' + parts.join(',');
    return look.__key;
  }

  /**
   * 取（或构建）某个外观的 atlas。
   * @param {object} look G.makeLook() 的结果
   * @param {string} tag  额外区分（一般传实体 id，让同外观不同实体共享）
   */
  G.getChibiAtlas = function (look, tag) {
    var key = lookKey(look);
    if (!atlasCache[key]) {
      atlasCache[key] = G.buildChibiAtlas(look);
    }
    return atlasCache[key];
  };

  // ---------- 动画表 ----------
  var PHASE_FRAMES = { idle: 2, walk: 4, attack: 3, hurt: 1, dead: 3 };
  var PHASE_FPS = { idle: 2.2, walk: 8, attack: 12, hurt: 10, dead: 6 };
  var PHASE_LOOP = { idle: true, walk: true, attack: false, hurt: false, dead: false };

  /** 计算"实体朝向"相对相机的 8 方向索引 */
  S.dirToCamera = function (facingAngle, cameraYaw) {
    // 屏幕方向 = 世界朝向 - 相机 yaw
    // 我们的 dir 定义：0 = 面向相机（南），顺时针
    var screenAngle = facingAngle - (cameraYaw + Math.PI);
    // 归一化到 -PI..PI
    while (screenAngle > Math.PI) screenAngle -= Math.PI * 2;
    while (screenAngle < -Math.PI) screenAngle += Math.PI * 2;
    // 0 -> 面向相机；注意 atan2 的 z 轴方向，需要翻转
    var idx = Math.round((screenAngle + Math.PI) / (Math.PI / 4));
    return ((idx % 8) + 8) % 8;
  };

  /** 简版：直接给世界朝向角（atan2(dz,dx)）和相机 yaw */
  S.dir8FromAngle = function (worldAngle, cameraYaw) {
    // 世界角度：0 = +x，PI/2 = +z
    // chibi 的 dir 0 = 面向相机 = 朝向 -z 方向（远离世界原点朝向相机）
    // 相机在 yaw 方向看向场景，所以"面向相机"的世界方向 = yaw + PI
    var faceCamAngle = cameraYaw + Math.PI;
    var rel = G.M.angleDelta(faceCamAngle, worldAngle);  // -PI..PI
    var idx = Math.round(rel / (Math.PI / 4));
    return ((idx % 8) + 8) % 8;
  };

  /**
   * 更新一个 sprite 的帧与朝向。
   * @param {THREE.Mesh} mesh  makeChibiMesh 的产物
   * @param {object} atlas
   * @param {number} dir8 0..7
   * @param {string} phase
   * @param {number} frame
   */
  S.update = function (mesh, atlas, dir8, phase, frame) {
    var info = atlas.frames[phase];
    if (!info) { phase = 'idle'; info = atlas.frames.idle; }
    var row = info.startRow + (frame % info.count);
    G.setChibiFrame(mesh, dir8, row);
    // 始终面向相机（等距下绕 Y 轴）
    if (G.camera.cam) {
      var cam = G.camera.cam;
      mesh.lookAt(cam.position.x, mesh.position.y, cam.position.z);
    }
  };

  // ---------- 动画状态机 ----------
  /**
   * 创建一个动画控制器，挂在实体上。
   */
  S.createAnimator = function () {
    return {
      phase: 'idle',
      frame: 0,
      t: 0,
      locked: false,       // attack/hurt/dead 期间锁定
      lockTimer: 0,
      hurtFlash: 0,
      set: function (phase, duration) {
        if (this.locked && phase !== 'dead') return;
        this.phase = phase;
        this.frame = 0;
        this.t = 0;
        if (phase === 'attack' || phase === 'hurt' || phase === 'dead') {
          this.locked = true;
          this.lockTimer = duration || (PHASE_FRAMES[phase] / PHASE_FPS[phase]);
        }
      },
      update: function (dt, moving) {
        if (this.locked) {
          this.lockTimer -= dt;
          var fps = PHASE_FPS[this.phase] || 8;
          this.t += dt;
          var frames = PHASE_FRAMES[this.phase] || 4;
          this.frame = Math.floor(this.t * fps);
          if (this.lockTimer <= 0 || this.frame >= frames) {
            if (this.phase === 'dead') {
              this.frame = frames - 1;
            } else {
              this.locked = false;
              this.phase = moving ? 'walk' : 'idle';
              this.frame = 0;
              this.t = 0;
            }
          }
        } else {
          var target = moving ? 'walk' : 'idle';
          if (this.phase !== target) {
            this.phase = target;
            this.frame = 0;
            this.t = 0;
          }
          this.t += dt;
          var f = PHASE_FPS[this.phase] || 4;
          var n = PHASE_FRAMES[this.phase] || 1;
          this.frame = Math.floor(this.t * f) % n;
        }
        if (this.hurtFlash > 0) this.hurtFlash -= dt;
      }
    };
  };

  // ---------- 落地阴影贴片 ----------
  var shadowTex = null;
  function getShadowTexture() {
    if (shadowTex) return shadowTex;
    var c = G.makeCanvas(32, 32);
    var ctx = c.getContext('2d');
    var grad = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, 'rgba(40,30,26,0.42)');
    grad.addColorStop(0.55, 'rgba(40,30,26,0.22)');
    grad.addColorStop(1, 'rgba(40,30,26,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    shadowTex = G.canvasTexture(c);
    return shadowTex;
  }

  /** 创建一个椭圆落地阴影（billboard 不投真实阴影，用这个代替） */
  S.makeShadow = function (w) {
    w = w || 1.05;
    var geo = new THREE.PlaneGeometry(w, w * 0.6);
    var mat = new THREE.MeshBasicMaterial({
      map: getShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.9
    });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
    m.renderOrder = 1;
    return m;
  };

})(window.G = window.G || {});
