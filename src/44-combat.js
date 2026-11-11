/* 44-combat.js — 战斗判定与打击反馈
 *
 * 四种判定：cone（扇形）、ring（环形）、line（直线）、point（点）
 * 四件套：hitstop / 屏震 / 伤害数字 / 受击闪白+击退
 */
(function (G) {
  'use strict';

  var M = G.M;

  var C = G.combat = {};

  // ---------- 命中收集 ----------
  /** 收集范围内的敌人 */
  function enemiesInCone(x, z, angle, arc, radius, includeDead) {
    var out = [];
    var list = G.enemy.list;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead && !includeDead) continue;
      var dx = e.x - x, dz = e.z - z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d > radius + e.radius) continue;
      if (arc < Math.PI * 2) {
        var ea = Math.atan2(dx, dz);
        var da = Math.abs(M.angleDelta(angle, ea));
        if (da > arc / 2) continue;
      }
      out.push({ enemy: e, dist: d });
    }
    return out;
  }

  function enemiesInRing(x, z, radius, includeDead) {
    var out = [];
    var list = G.enemy.list;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead && !includeDead) continue;
      var d = M.dist(x, z, e.x, e.z);
      if (d <= radius + e.radius) out.push({ enemy: e, dist: d });
    }
    return out;
  }

  // ---------- 应用伤害 ----------
  /**
   * 对一个敌人结算伤害。
   * @returns {number} 实际伤害
   */
  C.hitEnemy = function (e, damage, opts) {
    if (e.dead) return 0;
    opts = opts || {};

    var dmg = Math.max(1, damage - e.def * 0.6);
    dmg = Math.round(dmg);

    e.hp -= dmg;
    e.hitFlash = 0.2;

    // 击退
    if (opts.knockback && opts.fromX != null) {
      var n = M.norm(e.x - opts.fromX, e.z - opts.fromZ);
      e.knockX = n.x * opts.knockback;
      e.knockZ = n.z * opts.knockback;
      e.knockT = 0.18;
    }

    // 伤害数字
    G.fx.damageNumber(e.x, e.height || 1.5, e.z, dmg, {
      crit: opts.crit,
      element: opts.element
    });

    // 受击动画
    if (e.anim) e.anim.set('hurt', 0.18);

    // hitstop
    if (opts.hitstopMs) G.hitstop.trigger(opts.hitstopMs / 1000);

    // 吸血
    if (opts.lifesteal && opts.lifesteal > 0) {
      var st = G.player.state;
      st.hp = Math.min(st.maxHp, st.hp + dmg * opts.lifesteal);
    }

    if (e.hp <= 0) {
      G.enemy.kill(e, opts);
    }
    return dmg;
  };

  // ---------- 判定形状 ----------
  /**
   * 扇形判定。
   */
  C.cone = function (p) {
    var hits = enemiesInCone(p.x, p.z, p.angle, p.arc, p.radius);
    var total = 0;
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      var dmg = p.damage;
      var crit = false;
      if (p.critMult && Math.random() < (p.crit ? 1 : 0)) { crit = true; }
      // 简单：p.crit 决定是否暴击（由调用方掷骰）
      if (p.crit) { dmg *= (p.critMult || 1.8); crit = true; }
      var real = C.hitEnemy(h.enemy, dmg, {
        crit: crit,
        element: p.element,
        knockback: p.knockback,
        fromX: p.x, fromZ: p.z,
        hitstopMs: i === 0 ? p.hitstopMs : 0,
        lifesteal: G.player.state.lifesteal
      });
      total += real;
    }
    if (hits.length > 0) {
      G.bus.emit('sfx', 'hit');
      G.camera.shakeAdd(0.12 + Math.min(0.25, hits.length * 0.05), 0.1);
    }
    return total;
  };

  /**
   * 环形判定。
   */
  C.ring = function (p) {
    var hits = enemiesInRing(p.x, p.z, p.radius);
    var total = 0;
    for (var i = 0; i < hits.length; i++) {
      var dmg = p.damage * (p.crit ? (p.critMult || 1.8) : 1);
      total += C.hitEnemy(hits[i].enemy, dmg, {
        crit: p.crit,
        element: p.element,
        knockback: p.knockback,
        fromX: p.x, fromZ: p.z,
        hitstopMs: i === 0 ? p.hitstopMs : 0,
        lifesteal: G.player.state.lifesteal
      });
    }
    if (hits.length > 0) {
      G.bus.emit('sfx', 'hit');
      G.camera.shakeAdd(0.18 + Math.min(0.3, hits.length * 0.06), 0.14);
    }
    return total;
  };

  /**
   * 直线判定（投射物用，逐个点检查）。
   */
  C.hitscanLine = function (x0, z0, dx, dz, range, radius) {
    // 简化：沿射线采样，收集被扫到的敌人
    var seen = {}, out = [];
    var steps = Math.ceil(range / 0.5);
    for (var i = 1; i <= steps; i++) {
      var t = (i / steps) * range;
      var px = x0 + dx * t, pz = z0 + dz * t;
      var hits = enemiesInRing(px, pz, radius + 0.4);
      for (var h = 0; h < hits.length; h++) {
        var e = hits[h].enemy;
        if (!seen[e.id]) { seen[e.id] = true; out.push(e); }
      }
    }
    return out;
  };

  // ---------- 玩家受伤 ----------
  C.hitPlayer = function (damage, srcX, srcZ, opts) {
    opts = opts || {};
    var st = G.player.state;
    if (st.dead) return 0;

    // 格挡？
    if (G.skills.tryParry(st, { x: srcX, z: srcZ, mesh: true, height: 1.5 })) {
      return 0;
    }

    var real = G.player.takeDamage(damage, opts);
    if (real > 0 && opts.knockback) {
      var n = M.norm(st.x - srcX, st.z - srcZ);
      st.vx += n.x * opts.knockback * 3;
      st.vz += n.z * opts.knockback * 3;
    }
    return real;
  };

  // ---------- 命中停顿 ----------
  G.hitstop = {
    timer: 0,
    trigger: function (sec) {
      // 取较长的那个，避免重复触发叠加过久
      if (sec > this.timer) this.timer = sec;
    },
    update: function (dt) {
      if (this.timer > 0) {
        this.timer -= dt;
        return true;   // 表示这一帧处于停顿
      }
      return false;
    }
  };

})(window.G = window.G || {});
