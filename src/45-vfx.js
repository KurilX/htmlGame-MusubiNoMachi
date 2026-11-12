/* 45-vfx.js — 打击特效与屏幕反馈
 *
 * 全部用程序化几何 + 材质动画实现，无贴图资源。
 *
 * 【2026-11 修复：出村后特效"范围异常/被吞"】
 * 根因：所有特效的 y 都是写死的常量（0.30 / 0.35 / 0.40），
 * 而野外地面高度从 1.04 一路升到 8.96。特效被埋在地下最多 8.56 单位，
 * 玩家只能看到它从土里露出来的一小条，看起来像"范围不对"或"没打出来"。
 * 城镇地面恒为 0，所以村里完全正常 —— 和你观察到的现象一致。
 *
 * 修法：把"贴地"变成特效的默认行为，用 G.world.groundY(x,z) + 相对高度。
 * 同时新增 vfxY() 供所有特效统一取值，避免以后再加特效时又写死数字。
 */
(function (G) {
  'use strict';

  var M = G.M;
  var V = G.fx = {};

  var active = [];       // 活动特效
  var damageNumbers = []; // DOM 伤害数字

  /**
   * 特效的统一高度：地面高度 + 相对抬升。
   * 所有特效都必须走这里，不要写死数字（踩过：写死 0.35 导致野外全埋地下）。
   */
  V.atGround = function (x, z, lift) {
    return G.world.groundY(x, z) + (lift || 0);
  };

  /** 调试用：当前活动特效数量 */
  V.activeCount = function () { return active.length; };

  V.clear = function () {
    for (var i = 0; i < active.length; i++) {
      // 延迟项没有 obj，只有创建回调；直接丢弃即可
      if (active[i].obj && active[i].obj.parent) {
        active[i].obj.parent.remove(active[i].obj);
      }
    }
    active.length = 0;
    for (var j = 0; j < damageNumbers.length; j++) {
      var d = damageNumbers[j];
      if (d.el && d.el.parentNode) d.el.parentNode.removeChild(d.el);
    }
    damageNumbers.length = 0;
  };

  function add(obj, life, update) {
    G.world.scene.add(obj);
    active.push({ obj: obj, life: life, maxLife: life, update: update });
  }

  /**
   * 延迟创建特效 —— 替代 setTimeout。
   *
   * 【为什么要改】setTimeout 不受帧循环管辖：
   *   - hitstop 期间它照常触发（停顿感被破坏）
   *   - 切后台/暂停时它仍在跑
   *   - 场景重建后它可能往旧 scene 里加对象
   * 改为挂进 active 队列，由 update(dt) 驱动。
   */
  function delayed(sec, fn) {
    var pending = { obj: null, life: sec, maxLife: sec, delay: fn, isDelay: true };
    active.push(pending);
  }

  // =====================================================================
  // 扇形斩击
  // =====================================================================
  V.slashArc = function (x, z, angle, radius, arc) {
    var geo = new THREE.RingGeometry(radius * 0.25, radius, 16, 1,
      angle - arc / 2 - Math.PI / 2, arc);
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#FFFFFF'),
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, V.atGround(x, z, 0.35), z);
    add(m, 0.16, function (t, self) {
      self.material.opacity = 0.72 * (1 - t) * (1 - t);
      self.scale.setScalar(1 + t * 0.15);
    });
  };

  // =====================================================================
  // 月影斩（技能1）：更大更亮的一道
  // =====================================================================
  V.moonSlash = function (x, z, angle, radius) {
    // 两层错开 45ms 出现。用帧循环延迟而不是 setTimeout：
    // setTimeout 不受 hitstop 管辖，停顿期间照常触发，破坏打击感；
    // 而且在低帧率下会和渲染节拍错开，看起来像"两刀只出现一刀"。
    for (var k = 0; k < 2; k++) {
      (function (layerIndex, delaySec) {
        delayed(delaySec, function () {
          if (!G.world.scene) return;
          var geo = new THREE.RingGeometry(radius * 0.3, radius * 1.1, 20, 1,
            angle - Math.PI * 0.36 - Math.PI / 2, Math.PI * 0.72);
          var mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(layerIndex === 0 ? '#DCEFFF' : '#B8DCE8'),
            transparent: true,
            // 同 ringSlash：0.85 在亮背景上过曝成白块，降到 0.5
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          });
          var m = new THREE.Mesh(geo, mat);
          m.rotation.x = -Math.PI / 2;
          m.position.set(x, V.atGround(x, z, 0.4 + layerIndex * 0.12), z);
          add(m, 0.28, function (t, self) {
            self.material.opacity = 0.5 * (1 - t) * (1 - t);
            self.scale.setScalar(1 + t * 0.25);
          });
        });
      })(k, k * 0.045);
    }
    // 中心爆点
    V.impactRing(x, z, radius * 0.8, '#DCEFFF');
  };

  // =====================================================================
  // 环斩（技能2）
  // =====================================================================
  V.ringSlash = function (x, z, radius) {
    var geo = new THREE.RingGeometry(radius * 0.82, radius * 1.05, 28);
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#FFE9A8'),
      transparent: true,
      // 0.9 在明亮草地上配合 AdditiveBlending 会过曝成纯白块，
      // 把地面和角色全糊住（截图确认）。0.55 能看清攻击判定圈又不挡视线。
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, V.atGround(x, z, 0.3), z);
    add(m, 0.32, function (t, self) {
      // 二次曲线淡出：前段保持亮度，后段快速消失，比线性更有"打击"感
      self.material.opacity = 0.55 * (1 - t) * (1 - t);
      var s = 1 + t * 0.35;
      self.scale.set(s, 1, s);
    });
  };

  // =====================================================================
  // 冲击环（通用）
  // =====================================================================
  V.impactRing = function (x, z, radius, color) {
    var geo = new THREE.RingGeometry(radius * 0.6, radius, 20);
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color || '#FFFFFF'),
      transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, V.atGround(x, z, 0.25), z);
    add(m, 0.3, function (t, self) {
      self.material.opacity = 0.8 * (1 - t);
      var s = 1 + t * 1.2;
      self.scale.set(s, 1, s);
    });
  };

  // =====================================================================
  // 冲刺残影
  // =====================================================================
  V.dashTrail = function (x0, z0, x1, z1, color) {
    var dx = x1 - x0, dz = z1 - z0;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.1) return;
    var geo = new THREE.PlaneGeometry(len, 1.6);
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color || '#B8DCE8'),
      transparent: true, opacity: 0.42,
      depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.position.set((x0 + x1) / 2, 1.0, (z0 + z1) / 2);
    m.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
    add(m, 0.22, function (t, self) {
      self.material.opacity = 0.42 * (1 - t);
    });
  };

  // =====================================================================
  // 角色残影（chibi 立绘的淡出副本）
  // =====================================================================
  V.ghost = function (x, z, atlas, facing, phase, frame) {
    if (!atlas || !atlas.frames) return;
    var mat = new THREE.MeshBasicMaterial({
      map: atlas.tex,
      transparent: true,
      opacity: 0.4,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var w = 2.05 * (atlas.cw / atlas.ch);
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.05), mat);
    m.position.set(x, V.atGround(x, z, 1.02), z);
    // 关键：setChibiFrame 从 mesh.userData.atlas 读 w/h 信息，
    // 残影是临时 mesh，必须挂上去（踩过：不挂 -> atlas undefined -> 报错）
    m.userData.atlas = atlas;
    var dir8 = G.sprite.dir8FromAngle(facing, G.camera.yaw);
    var info = atlas.frames[phase] || atlas.frames.idle;
    G.setChibiFrame(m, dir8, info.startRow + (frame % info.count));
    var cam = G.camera.cam;
    if (cam) m.lookAt(cam.position.x, m.position.y, cam.position.z);
    add(m, 0.28, function (t, self) {
      self.material.opacity = 0.4 * (1 - t);
    });
  };

  // =====================================================================
  // 格挡光环
  // =====================================================================
  V.parryAura = function (x, z) {
    var geo = new THREE.RingGeometry(1.1, 1.45, 24);
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#E8C25A'),
      transparent: true, opacity: 0.65,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, V.atGround(x, z, 0.4), z);
    G.world.scene.add(m);
    // 持续到 parry 结束由 entity 管理，这里做视觉脉冲
    var life = 1.2;
    active.push({
      obj: m, life: life, maxLife: life,
      update: function (t, self) {
        self.material.opacity = 0.65 * (1 - t * 0.5);
        self.rotation.z += 0.06;
        self.position.x = G.player.state.x;
        self.position.z = G.player.state.z;
      }
    });
  };

  V.parryFlash = function (x, z, angle) {
    V.moonSlash(x, z, angle, 3.2);
    // 金色爆闪
    var geo = new THREE.SphereGeometry(1.2, 10, 8);
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#FFE9A8'),
      transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, V.atGround(x, z, 1.2), z);
    add(m, 0.25, function (t, self) {
      self.material.opacity = 0.9 * (1 - t);
      self.scale.setScalar(1 + t * 2.5);
    });
  };

  // =====================================================================
  // 伤害数字（DOM 覆盖层，字永远清楚）
  // =====================================================================
  V.damageNumber = function (x, y, z, value, opts) {
    opts = opts || {};
    var layer = G.ui && G.ui.damageLayer;
    if (!layer) return;
    var el = document.createElement('div');
    el.className = 'dmg' + (opts.crit ? ' crit' : '') + (opts.playerTaking ? ' taken' : '');
    el.textContent = opts.crit ? (value + '!') : String(value);
    layer.appendChild(el);
    damageNumbers.push({
      el: el, x: x, y: y, z: z,
      life: 0.9, maxLife: 0.9,
      vx: opts.playerTaking ? 0 : (Math.random() - 0.5) * 22,
      vy: -46 - Math.random() * 18,
      scale: opts.crit ? 1.5 : 1
    });
  };

  // =====================================================================
  // 升级 / 拾取 / 传送
  // =====================================================================
  V.levelUp = function (x, z) {
    for (var i = 0; i < 3; i++) {
      (function (k, delaySec) {
        delayed(delaySec, function () {
          if (!G.world.scene) return;
          var geo = new THREE.RingGeometry(0.6, 0.9, 20);
          var mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color('#FFE9A8'),
            transparent: true, opacity: 0.85,
            side: THREE.DoubleSide, depthWrite: false,
            blending: THREE.AdditiveBlending
          });
          var m = new THREE.Mesh(geo, mat);
          m.rotation.x = -Math.PI / 2;
          m.position.set(x, V.atGround(x, z, 0.25 + k * 0.5), z);
          add(m, 0.6, function (t, self) {
            self.material.opacity = 0.85 * (1 - t);
            self.scale.setScalar(1 + t * 2.4);
          });
        });
      })(i, i * 0.1);
    }
    G.ui.toast('✦ 等级提升 ✦', 1800);
  };

  V.pickupBurst = function (x, z, color) {
    var n = 6;
    for (var i = 0; i < n; i++) {
      var geo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
      var mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color || '#E8C25A'),
        transparent: true, opacity: 0.95, depthWrite: false
      });
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, V.atGround(x, z, 1.0), z);
      var a = (i / n) * Math.PI * 2;
      var sp = 2.2 + Math.random() * 1.6;
      add(m, 0.5, (function (ang, s) {
        return function (t, self) {
          self.material.opacity = 0.95 * (1 - t);
          self.position.x = x + Math.cos(ang) * s * t * 0.9;
          self.position.z = z + Math.sin(ang) * s * t * 0.9;
          self.position.y = 1.0 + Math.sin(t * Math.PI) * 1.1 - t * 0.4;
          self.rotation.x += 0.2; self.rotation.y += 0.25;
        };
      })(a, sp));
    }
  };

  // =====================================================================
  // 每帧更新
  // =====================================================================
  V.update = function (dt) {
    // 3D 特效
    for (var i = active.length - 1; i >= 0; i--) {
      var a = active[i];

      // 延迟项：倒计时结束后执行一次创建回调，然后出队
      if (a.isDelay) {
        a.life -= dt;
        if (a.life <= 0) {
          active.splice(i, 1);
          try { a.delay(); } catch (e) { console.warn('[vfx] delayed callback failed', e); }
        }
        continue;
      }

      a.life -= dt;
      var t = 1 - Math.max(0, a.life) / a.maxLife;
      if (a.update) a.update(t, a.obj);
      if (a.life <= 0) {
        if (a.obj && a.obj.parent) a.obj.parent.remove(a.obj);
        if (a.obj && a.obj.geometry) a.obj.geometry.dispose();
        if (a.obj && a.obj.material) a.obj.material.dispose();
        active.splice(i, 1);
      }
    }

    // 伤害数字（DOM 定位）
    for (var j = damageNumbers.length - 1; j >= 0; j--) {
      var d = damageNumbers[j];
      d.life -= dt;
      var tt = 1 - Math.max(0, d.life) / d.maxLife;
      if (d.life <= 0) {
        if (d.el.parentNode) d.el.parentNode.removeChild(d.el);
        damageNumbers.splice(j, 1);
        continue;
      }
      var p = G.camera.worldToScreen(d.x, d.y + tt * 1.4, d.z);
      var scalePop = tt < 0.15 ? (0.6 + tt / 0.15 * 0.55) : 1.05;
      d.el.style.left = p.x + 'px';
      d.el.style.top = p.y + 'px';
      d.el.style.opacity = String(Math.max(0, 1 - tt * 1.1));
      d.el.style.transform = 'translate(-50%,-50%) scale(' + (scalePop * d.scale) + ')';
    }
  };

})(window.G = window.G || {});
