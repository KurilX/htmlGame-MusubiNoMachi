/* 41-enemy.js — 怪物 AI 与运行时
 *
 * AI 类型：
 *   chaser  - 直线追击，贴脸前摇攻击
 *   ranged  - 保持距离投射
 *   pack    - 群居，仇恨联动
 *   tank    - 慢、血厚、有格挡姿态
 *   boss    - 分阶段，多招式
 */
(function (G) {
  'use strict';

  var M = G.M;
  var E = G.enemy = {
    list: [],
    nextId: 1
  };

  /**
   * 生成一只怪。
   */
  E.spawn = function (defId, x, z, zone) {
    var def = G.DATA.MONSTERS[defId];
    if (!def) return null;

    var look = G.makeLook(def.look);
    var atlas = G.getChibiAtlas(look, defId);
    var mesh = G.makeChibiMesh(atlas, { worldH: (def.height || 1.7) * 1.05 });
    mesh.position.set(x, G.world.groundY(x, z) + (def.height || 1.7) * 0.5 + (def.floatOffset || 0), z);
    G.world.scene.add(mesh);

    var shadow = G.sprite.makeShadow(def.radius * 2.2);
    shadow.position.set(x, G.world.groundY(x, z) + 0.02, z);
    G.world.scene.add(shadow);

    var anim = G.sprite.createAnimator();

    // 血量条（世界空间贴片）
    var bar = E.makeHpBar(def);

    var e = {
      id: E.nextId++,
      defId: defId,
      def: def,                 // 定义对象（只读）
      defStat: def.def || 0,    // 防御数值（避免 e.def 命名歧义）
      x: x, z: z,
      hp: def.hp, maxHp: def.hp,
      radius: def.radius, height: def.height,
      facing: Math.PI,
      mesh: mesh, atlas: atlas, shadow: shadow, anim: anim, hpBar: bar,
      state: 'idle',            // idle | chase | windup | attack | hurt | dead
      stateTimer: 0,
      attackCd: Math.random() * def.attackCd,
      telegraph: 0,
      knockX: 0, knockZ: 0, knockT: 0,
      hitFlash: 0,
      dead: false,
      deadTimer: 0,
      zone: zone,
      exp: def.exp, goldMin: def.goldMin, goldMax: def.goldMax,
      phase: 0,
      // boss 用
      moveTimer: 0,
      summonCount: 0
    };

    mesh.userData.entity = e;
    G.sprite.update(mesh, atlas, 4, 'idle', 0);
    E.list.push(e);
    return e;
  };

  /** 血条：一个始终面向相机的小平面 + canvas 纹理 */
  E.makeHpBar = function (def) {
    var c = G.makeCanvas(64, 8);
    var ctx = c.getContext('2d');
    var tex = G.canvasTexture(c);
    var mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false
    });
    var w = def.tier === 'boss' ? 2.6 : (def.tier === 'elite' ? 1.4 : 1.0);
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.125), mat);
    m.renderOrder = 999;
    m.visible = false;
    G.world.scene.add(m);
    return { mesh: m, canvas: c, ctx: ctx, tex: tex, w: w };
  };

  E.drawHpBar = function (e) {
    var bar = e.hpBar;
    if (!bar) return;
    var ctx = bar.ctx;
    var W = 64, H = 8;
    ctx.clearRect(0, 0, W, H);
    var pct = Math.max(0, e.hp / e.maxHp);
    // 底
    ctx.fillStyle = 'rgba(30,24,22,0.72)';
    ctx.fillRect(0, 0, W, H);
    // 血
    var col = e.def.tier === 'boss' ? '#D9A0E8'
      : (e.def.tier === 'elite' ? '#E8C25A' : '#E05A4F');
    ctx.fillStyle = col;
    ctx.fillRect(1, 1, Math.floor((W - 2) * pct), H - 2);
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(1, 1, Math.floor((W - 2) * pct), 2);
    bar.tex.needsUpdate = true;
  };

  // =====================================================================
  // 每帧更新
  // =====================================================================
  E.update = function (dt, player) {
    var st = player.state;
    for (var i = E.list.length - 1; i >= 0; i--) {
      var e = E.list[i];
      E.updateOne(e, dt, st);

      if (e.dead) {
        e.deadTimer -= dt;
        // 死亡淡出
        var t = Math.max(0, e.deadTimer / 0.9);
        e.mesh.material.opacity = t;
        e.mesh.position.y = (e.def.height || 1.7) * 0.5 * t;
        e.shadow.material.opacity = 0.9 * t;
        if (e.hpBar) e.hpBar.mesh.visible = false;
        if (e.deadTimer <= 0) {
          E.remove(e);
          E.list.splice(i, 1);
        }
      }
    }
  };

  E.updateOne = function (e, dt, st) {
    var def = e.def;
    if (e.dead) return;

    // 计时器
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.stateTimer = Math.max(0, e.stateTimer - dt);

    // 击退
    if (e.knockT > 0) {
      e.knockT -= dt;
      e.x += e.knockX * dt;
      e.z += e.knockZ * dt;
      e.knockX *= Math.pow(0.02, dt);
      e.knockZ *= Math.pow(0.02, dt);
    }

    var dx = st.x - e.x, dz = st.z - e.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var playerAlive = !st.dead;

    // 死亡/玩家死亡时不再行动
    if (!playerAlive) {
      e.state = 'idle';
      E.syncVisual(e, dt, false, st);
      return;
    }

    // ---- 状态机 ----
    switch (e.state) {
      case 'idle':
        if (dist < def.aggroRange) {
          e.state = 'chase';
          // 群居联动：唤醒附近同群
          if (def.ai === 'pack') E.wakePack(e);
        } else {
          // 游荡
          e.wanderT = (e.wanderT || 0) - dt;
          if (e.wanderT <= 0) {
            e.wanderT = 2 + Math.random() * 3;
            e.wanderDx = (Math.random() - 0.5) * 2;
            e.wanderDz = (Math.random() - 0.5) * 2;
          }
          if (e.wanderDx || e.wanderDz) {
            e.x += e.wanderDx * dt * 0.5;
            e.z += e.wanderDz * dt * 0.5;
            e.facing = Math.atan2(e.wanderDx, e.wanderDz);
          }
        }
        break;

      case 'chase':
        e.facing = Math.atan2(dx, dz);
        if (dist > def.aggroRange * 1.7) {
          e.state = 'idle';
          break;
        }
        if (E.inAttackRange(def, dist)) {
          if (e.attackCd <= 0) {
            e.state = 'windup';
            e.stateTimer = def.telegraphSec;
            e.telegraph = def.telegraphSec;
          }
        } else {
          // 移动到攻击距离
          var spd = def.speed;
          if (def.ai === 'ranged' && dist < def.attackRange * 0.7) {
            spd = -spd * 0.8;   // 太近则后退
          }
          var n = M.norm(dx, dz);
          var nx = e.x + n.x * spd * dt;
          var nz = e.z + n.z * spd * dt;
          var res = G.world.resolveCollision(nx, nz, e.radius);
          e.x = res.x; e.z = res.z;
        }
        break;

      case 'windup':
        // 前摇：站定，可读
        if (e.telegraph > 0) {
          e.telegraph -= dt;
          // 前摇最后一帧才真正出手
          if (e.telegraph <= 0) {
            E.doAttack(e, st, dist);
            e.state = 'chase';
            e.attackCd = def.attackCd;
          }
        } else {
          e.state = 'chase';
        }
        break;
    }

    // boss 阶段
    if (def.ai === 'boss') E.updateBoss(e, dt, st, dist);

    E.syncVisual(e, dt, true, st);
  };

  E.inAttackRange = function (def, dist) {
    return dist <= def.attackRange + def.radius * 0.5;
  };

  /** 怪物的攻击 */
  E.doAttack = function (e, st, dist) {
    var def = e.def;
    if (def.ai === 'ranged') {
      // 发射投射物
      var ang = Math.atan2(st.x - e.x, st.z - e.z);
      G.projectiles.add({
        x: e.x, z: e.z,
        dirX: Math.sin(ang), dirZ: Math.cos(ang),
        speed: def.projectileSpeed || 8,
        range: 16, traveled: 0, radius: 0.45,
        damage: def.atk, source: 'enemy',
        color: def.id === 'yurei' ? '#C8B0E0' : '#E8A0A8',
        pierce: 0, hit: [],
        hitstopMs: 0
      });
      G.bus.emit('sfx', 'enemy_cast');
      return;
    }

    // 近战：先做朝向判定（玩家在正面扇形内才吃伤害）
    var da = Math.abs(M.angleDelta(e.facing, Math.atan2(st.x - e.x, st.z - e.z)));
    var reach = def.attackRange + 0.8;
    if (dist <= reach && da <= Math.PI * 0.42) {
      G.combat.hitPlayer(def.atk, e.x, e.z, { knockback: 1.4 });
      G.fx.slashArc(e.x, e.z, e.facing, reach, Math.PI * 0.7);
    } else {
      // 落空：仍然播特效，让玩家看到"刚才没打中"
      G.fx.slashArc(e.x, e.z, e.facing, reach, Math.PI * 0.7);
    }
  };

  /** 怪物对玩家造成伤害（真正入口） */
  E.hitPlayer = function (e, st) {
    var def = e.def;
    G.combat.hitPlayer(def.atk, e.x, e.z, { knockback: def.knockback || 1.2 });
  };

  E.wakePack = function (e) {
    for (var i = 0; i < E.list.length; i++) {
      var o = E.list[i];
      if (o === e || o.dead) continue;
      if (o.defId !== e.defId) continue;
      if (M.dist(e.x, e.z, o.x, o.z) < 10) {
        o.state = 'chase';
      }
    }
  };

  // =====================================================================
  // Boss
  // =====================================================================
  E.updateBoss = function (e, dt, st, dist) {
    var def = e.def;
    var hpPct = e.hp / e.maxHp;
    e.moveTimer -= dt;

    // 阶段切换
    var newPhase = 0;
    for (var i = 0; i < def.phases.length; i++) {
      if (hpPct <= def.phases[i].hpBelow) newPhase = i;
    }
    if (newPhase !== e.phase) {
      e.phase = newPhase;
      G.ui.bossPhase(e, newPhase);
    }

    // 召唤阶段
    if (def.phases[e.phase].move === 'summon' && e.moveTimer <= 0 && e.summonCount < 4) {
      e.moveTimer = 9;
      e.summonCount++;
      for (var s = 0; s < 2; s++) {
        var a = Math.random() * Math.PI * 2;
        var sx = e.x + Math.cos(a) * 3.5;
        var sz = e.z + Math.sin(a) * 3.5;
        var minion = E.spawn('onibi', sx, sz, null);
        if (minion) { minion.state = 'chase'; }
      }
      G.ui.toast('結びの神 召唤了鬼火', 1600);
    }

    // AOE 重击阶段
    if (def.phases[e.phase].move === 'aoe_slam' && e.moveTimer <= 0) {
      e.moveTimer = 5.5;
      G.ui.bossTelegraph(e, 1.1);
      setTimeout(function () {
        if (e.dead || !G.world.scene) return;
        var d = M.dist(e.x, e.z, G.player.state.x, G.player.state.z);
        if (d < 6.5) {
          G.combat.hitPlayer(def.atk * 2.2, e.x, e.z, { knockback: 3 });
        }
        G.fx.impactRing(e.x, e.z, 6.5, '#D9A0E8');
        G.camera.shakeAdd(0.6, 0.4);
        G.bus.emit('sfx', 'boss_slam');
      }, 1100);
    }
  };

  // =====================================================================
  // 视觉同步
  // =====================================================================
  E.syncVisual = function (e, dt, active, st) {
    var def = e.def;
    var mesh = e.mesh;
    mesh.position.x = e.x;
    mesh.position.z = e.z;
    var gy = G.world.groundY(e.x, e.z);
    var baseY = gy + (def.height || 1.7) * 0.5;
    if (def.floatOffset) {
      baseY += def.floatOffset + Math.sin(performance.now() * 0.002 + e.id) * 0.12;
    }
    mesh.position.y = baseY;

    var moving = active && e.state === 'chase';
    e.anim.update(dt, moving);

    // 前摇时压暗/放大提示
    if (e.state === 'windup') {
      var k = 1 + Math.sin(performance.now() * 0.03) * 0.06;
      mesh.scale.set(k, 1 / k, 1);
    } else {
      mesh.scale.set(1, 1, 1);
    }

    var dir8 = G.sprite.dir8FromAngle(e.facing, G.camera.yaw);
    G.sprite.update(mesh, e.atlas, dir8, e.anim.phase, e.anim.frame);

    // 阴影
    e.shadow.position.x = e.x;
    e.shadow.position.z = e.z;
    e.shadow.position.y = G.world.groundY(e.x, e.z) + 0.02;
    e.shadow.visible = !e.dead;

    // 受击闪红
    var mat = mesh.material;
    if (e.hitFlash > 0) {
      mat.color.setHex(0xFF9A8A);
    } else if (e.state === 'windup') {
      mat.color.setHex(0xFFC8C0);
    } else {
      mat.color.setHex(0xFFFFFF);
    }

    // 血条
    if (e.hpBar) {
      var showBar = e.hp < e.maxHp && !e.dead;
      e.hpBar.mesh.visible = showBar;
      if (showBar) {
        var barY = G.world.groundY(e.x, e.z) + (def.height || 1.7) + 0.35;
        e.hpBar.mesh.position.set(e.x, barY, e.z);
        if (G.camera.cam) {
          e.hpBar.mesh.lookAt(G.camera.cam.position.x, barY, G.camera.cam.position.z);
        }
        // 【性能】只在血量真的变化时重绘。
        //
        // 原来无条件每帧 drawHpBar。它会：
        //   clearRect + 3 次 fillRect + tex.needsUpdate = true
        // 最后一行会让这张 64x8 的纹理**每帧重新上传到 GPU**，
        // 而上传统一是同步阻塞的，还会打断渲染批次。
        // 战斗时场上 5~8 只残血敌人 => 每帧 5~8 次纹理上传。
        //
        // 血条只在掉血时才需要变，按 hp 缓存即可。
        if (e.hpBar.lastHp !== e.hp) {
          E.drawHpBar(e);
          e.hpBar.lastHp = e.hp;
        }
      }
    }
  };

  // =====================================================================
  // 死亡
  // =====================================================================
  E.kill = function (e, opts) {
    if (e.dead) return;
    e.dead = true;
    e.deadTimer = 0.9;
    e.anim.set('dead', 999);
    e.mesh.material.transparent = true;
    if (e.hpBar) e.hpBar.mesh.visible = false;

    // 掉落
    var def = e.def;
    G.loot.spawnFromTable(def.loot, e.x, e.z, def);

    // 经验
    G.player.gainExp(def.exp);

    G.bus.emit('enemy:killed', { defId: e.defId, x: e.x, z: e.z });
    G.bus.emit('sfx', 'enemy_die');
    G.fx.impactRing(e.x, e.z, 1.2, '#E8C25A');

    // 任务进度
    if (G.quest) G.quest.onKill(e.defId);
  };

  E.remove = function (e) {
    if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
    if (e.shadow.parent) e.shadow.parent.remove(e.shadow);
    if (e.hpBar && e.hpBar.mesh.parent) e.hpBar.mesh.parent.remove(e.hpBar.mesh);
    if (e.mesh.geometry) e.mesh.geometry.dispose();
    if (e.mesh.material) e.mesh.material.dispose();
  };

  E.clear = function () {
    for (var i = 0; i < E.list.length; i++) E.remove(E.list[i]);
    E.list.length = 0;
  };

  /** 最近的敌人（用于锁定/UI） */
  E.nearest = function (x, z, maxDist) {
    var best = null, bestD = maxDist || 99;
    for (var i = 0; i < E.list.length; i++) {
      var e = E.list[i];
      if (e.dead) continue;
      var d = M.dist(x, z, e.x, e.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  };

})(window.G = window.G || {});
