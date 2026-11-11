/* 45-vfx.js — 打击特效与屏幕反馈
 *
 * 全部用程序化几何 + 材质动画实现，无贴图资源。
 */
(function (G) {
  'use strict';

  var M = G.M;
  var V = G.fx = {};

  var active = [];       // 活动特效
  var damageNumbers = []; // DOM 伤害数字

  V.clear = function () {
    for (var i = 0; i < active.length; i++) {
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
    m.position.set(x, 0.35, z);
    add(m, 0.16, function (t, self) {
      self.material.opacity = 0.72 * (1 - t) * (1 - t);
      self.scale.setScalar(1 + t * 0.15);
    });
  };

  // =====================================================================
  // 月影斩（技能1）：更大更亮的一道
  // =====================================================================
  V.moonSlash = function (x, z, angle, radius) {
    for (var k = 0; k < 2; k++) {
      (function (delay) {
        setTimeout(function () {
          if (!G.world.scene) return;
          var geo = new THREE.RingGeometry(radius * 0.3, radius * 1.1, 20, 1,
            angle - Math.PI * 0.36 - Math.PI / 2, Math.PI * 0.72);
          var mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(k === 0 ? '#DCEFFF' : '#B8DCE8'),
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          });
          var m = new THREE.Mesh(geo, mat);
          m.rotation.x = -Math.PI / 2;
          m.position.set(x, 0.4 + k * 0.12, z);
          add(m, 0.28, function (t, self) {
            self.material.opacity = 0.85 * (1 - t);
            self.scale.setScalar(1 + t * 0.25);
          });
        }, delay);
      })(k * 45);
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
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.3, z);
    add(m, 0.32, function (t, self) {
      self.material.opacity = 0.9 * (1 - t);
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
    m.position.set(x, 0.25, z);
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
    if (!atlas) return;
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
    m.position.set(x, 1.02, z);
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
    m.position.set(x, 0.4, z);
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
    m.position.set(x, 1.2, z);
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
      (function (k) {
        setTimeout(function () {
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
          m.position.set(x, 0.25 + k * 0.5, z);
          add(m, 0.6, function (t, self) {
            self.material.opacity = 0.85 * (1 - t);
            self.scale.setScalar(1 + t * 2.4);
          });
        }, k * 100);
      })(i);
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
      m.position.set(x, 1.0, z);
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
      a.life -= dt;
      var t = 1 - Math.max(0, a.life) / a.maxLife;
      if (a.update) a.update(t, a.obj);
      if (a.life <= 0) {
        if (a.obj.parent) a.obj.parent.remove(a.obj);
        if (a.obj.geometry) a.obj.geometry.dispose();
        if (a.obj.material) a.obj.material.dispose();
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
