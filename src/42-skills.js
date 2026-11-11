/* 42-skills.js — 技能实现 */
(function (G) {
  'use strict';

  var M = G.M;

  var S = G.skills = {};

  /** 已激活的持续效果（格挡等） */
  S.activeEffects = [];

  /**
   * 施放技能。
   * @returns {boolean} 是否成功施放
   */
  S.cast = function (n, def, st, angle, target) {
    switch (def.type) {
      case 'dash_slash':
        S.dashSlash(def, st, angle);
        return true;
      case 'aoe_ring':
        S.aoeRing(def, st, angle);
        return true;
      case 'projectile':
        S.projectile(def, st, angle, target);
        return true;
      case 'parry':
        S.parry(def, st, angle);
        return true;
    }
    return false;
  };

  // ---------- 抜刀・月影：瞬身前斩 ----------
  S.dashSlash = function (def, st, angle) {
    var nx = Math.sin(angle), nz = Math.cos(angle);
    var fromX = st.x, fromZ = st.z;

    // 冲刺位移
    var tx = st.x + nx * def.dashDist;
    var tz = st.z + nz * def.dashDist;
    var res = G.world.resolveCollision(tx, tz, 0.34);
    st.x = res.x; st.z = res.z;
    st.invuln = Math.max(st.invuln, 0.18);
    st.moveLock = 0.22;

    // 残影
    G.fx.dashTrail(fromX, fromZ, st.x, st.z, '#B8DCE8');

    // 命中判定：扇形
    G.combat.cone({
      x: st.x, z: st.z, angle: angle, arc: def.arc, radius: def.radius,
      damage: st.atk * def.damageMult,
      crit: Math.random() < st.crit,
      critMult: st.critMult,
      source: 'player',
      knockback: 4.5,
      hitstopMs: def.hitstopMs,
      element: 'blade'
    });

    // 视觉
    G.fx.moonSlash(st.x, st.z, angle, def.radius);
    G.camera.shakeAdd(def.shake, 0.18);
    G.bus.emit('sfx', def.sfx);
    st.attackAnim = 0.3;
  };

  // ---------- 斬鉄・輪：环斩 ----------
  S.aoeRing = function (def, st, angle) {
    G.combat.ring({
      x: st.x, z: st.z, radius: def.radius,
      damage: st.atk * def.damageMult,
      crit: Math.random() < st.crit,
      critMult: st.critMult,
      source: 'player',
      knockback: def.knockback,
      hitstopMs: def.hitstopMs,
      element: 'blade'
    });
    G.fx.ringSlash(st.x, st.z, def.radius);
    G.camera.shakeAdd(def.shake, 0.2);
    G.bus.emit('sfx', def.sfx);
    st.attackAnim = 0.28;
    st.moveLock = 0.2;
    st.invuln = Math.max(st.invuln, 0.12);
  };

  // ---------- 飛刃・風切り：投射物 ----------
  S.projectile = function (def, st, angle, target) {
    G.projectiles.add({
      x: st.x, z: st.z,
      dirX: Math.sin(angle), dirZ: Math.cos(angle),
      speed: def.speed,
      range: def.range,
      traveled: 0,
      radius: 0.5,
      damage: st.atk * def.damageMult,
      crit: Math.random() < st.crit,
      critMult: st.critMult,
      pierce: def.pierce,
      hit: [],
      hitstopMs: def.hitstopMs,
      source: 'player',
      color: '#B8DCE8'
    });
    G.bus.emit('sfx', def.sfx);
    st.attackAnim = 0.22;
    G.camera.shakeAdd(0.1, 0.08);
  };

  // ---------- 受け流し：格挡反击 ----------
  S.parry = function (def, st, angle) {
    st.parry = {
      timer: def.duration,
      def: def,
      used: false
    };
    G.fx.parryAura(st.x, st.z);
    G.bus.emit('sfx', def.sfx);
    st.attackAnim = 0.2;
    st.moveLock = 0.15;
    G.ui.toast('受け流し — 架刀', 700);
  };

  /** 每帧更新持续效果（由主循环调用） */
  S.update = function (dt, st) {
    if (st.parry) {
      st.parry.timer -= dt;
      if (st.parry.timer <= 0) {
        st.parry = null;
      }
    }
  };

  /** 受到攻击时调用；若在格挡窗口内，触发反击 */
  S.tryParry = function (st, attacker) {
    if (!st.parry || st.parry.used) return false;
    st.parry.used = true;
    var def = st.parry.def;

    // 反击
    if (attacker && attacker.mesh) {
      var ax = attacker.x, az = attacker.z;
      var ang = Math.atan2(ax - st.x, az - st.z);
      G.combat.cone({
        x: st.x, z: st.z, angle: ang, arc: Math.PI * 0.5, radius: def.radius,
        damage: st.atk * def.damageMult,
        crit: true, critMult: st.critMult,
        source: 'player',
        knockback: def.knockback,
        hitstopMs: def.hitstopMs,
        element: 'blade'
      });
      G.fx.parryFlash(st.x, st.z, ang);
      G.camera.shakeAdd(def.shake, 0.24);
      G.bus.emit('sfx', 'parry_hit');
      G.ui.toast('見切り！', 900);
      G.hitstop.trigger(0.12);
    }
    st.parry = null;
    st.invuln = Math.max(st.invuln, 0.3);
    return true;
  };

})(window.G = window.G || {});
