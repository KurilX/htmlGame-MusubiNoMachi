/* 46-projectiles.js — 投射物
 */
(function (G) {
  'use strict';

  var M = G.M;
  var P = G.projectiles = { list: [] };

  P.clear = function () {
    for (var i = 0; i < P.list.length; i++) {
      var p = P.list[i];
      if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
      if (p.mesh && p.mesh.geometry) p.mesh.geometry.dispose();
      if (p.mesh && p.mesh.material) p.mesh.material.dispose();
    }
    P.list.length = 0;
  };

  P.add = function (cfg) {
    var geo;
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(cfg.color || '#FFFFFF'),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    if (cfg.source === 'player') {
      // 气刃：细长的菱形
      geo = new THREE.OctahedronGeometry(cfg.radius || 0.4, 0);
    } else {
      // 敌方弹：球
      geo = new THREE.SphereGeometry(cfg.radius || 0.3, 6, 5);
    }
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cfg.x, 1.0, cfg.z);
    mesh.scale.set(1, 1, cfg.source === 'player' ? 2.4 : 1);
    G.world.scene.add(mesh);

    var proj = {
      x: cfg.x, z: cfg.z,
      dirX: cfg.dirX, dirZ: cfg.dirZ,
      speed: cfg.speed, range: cfg.range,
      traveled: 0, radius: cfg.radius,
      damage: cfg.damage, source: cfg.source,
      pierce: cfg.pierce || 0,
      hit: cfg.hit || [],
      hitstopMs: cfg.hitstopMs || 0,
      crit: cfg.crit, critMult: cfg.critMult,
      color: cfg.color,
      mesh: mesh,
      dead: false
    };
    mat.blending = THREE.NormalBlending;

    // 拖尾
    var trailGeo = new THREE.PlaneGeometry(0.3, 1.4);
    var trailMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(cfg.color || '#FFFFFF'),
      transparent: true, opacity: 0.4,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    var trail = new THREE.Mesh(trailGeo, trailMat);
    trail.rotation.x = -Math.PI / 2;
    trail.position.y = 0.15;
    mesh.add(trail);
    proj.trail = trail;

    P.list.push(proj);
    return proj;
  };

  P.update = function (dt) {
    for (var i = P.list.length - 1; i >= 0; i--) {
      var p = P.list[i];
      if (p.dead) { P.destroy(p, i); continue; }

      var step = p.speed * dt;
      p.x += p.dirX * step;
      p.z += p.dirZ * step;
      p.traveled += step;

      p.mesh.position.x = p.x;
      p.mesh.position.z = p.z;
      // 朝向
      p.trail.rotation.z = Math.atan2(p.dirX, p.dirZ);
      p.mesh.rotation.y = Math.atan2(p.dirX, p.dirZ);

      // 碰撞
      if (p.source === 'player') {
        var list = G.enemy.list;
        for (var k = 0; k < list.length; k++) {
          var e = list[k];
          if (e.dead) continue;
          if (p.hit.indexOf(e.id) >= 0) continue;
          if (M.dist(p.x, p.z, e.x, e.z) < p.radius + e.radius) {
            var dmg = p.damage * (p.crit ? (p.critMult || 1.8) : 1);
            G.combat.hitEnemy(e, dmg, {
              crit: p.crit, element: 'blade',
              hitstopMs: p.hitstopMs,
              lifesteal: G.player.state.lifesteal
            });
            p.hit.push(e.id);
            if (p.hit.length > p.pierce) { p.dead = true; break; }
          }
        }
      } else {
        var st = G.player.state;
        if (!st.dead && M.dist(p.x, p.z, st.x, st.z) < p.radius + 0.4) {
          G.combat.hitPlayer(p.damage, p.x, p.z, { knockback: 0.8 });
          p.dead = true;
        }
      }

      // 超出射程
      if (p.traveled > p.range) p.dead = true;
      // 撞墙
      var res = G.world.resolveCollision(p.x, p.z, 0.1);
      if (M.dist(res.x, res.z, p.x, p.z) > 0.05) p.dead = true;

      if (p.dead) P.destroy(p, i);
    }
  };

  P.destroy = function (p, idx) {
    if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
    if (p.mesh) {
      if (p.mesh.geometry) p.mesh.geometry.dispose();
      if (p.mesh.material) p.mesh.material.dispose();
    }
    P.list.splice(idx, 1);
  };

})(window.G = window.G || {});
