/* 40-player.js — 玩家控制与状态
 */
(function (G) {
  'use strict';

  var M = G.M;

  var P = G.player = {
    state: null,
    mesh: null,
    atlas: null,
    shadow: null,
    anim: null,
    look: null
  };

  P.init = function (saveData) {
    var look = G.makeLook(saveData && saveData.appearance);
    P.look = look;
    var atlas = G.getChibiAtlas(look, 'player');
    P.atlas = atlas;

    var mesh = G.makeChibiMesh(atlas, { worldH: 2.05 });
    P.mesh = mesh;
    G.world.scene.add(mesh);

    var shadow = G.sprite.makeShadow(1.15);
    G.world.scene.add(shadow);
    P.shadow = shadow;

    P.anim = G.sprite.createAnimator();

    var sp = G.DATA.WORLD.spawn;
    var st = {
      name: (saveData && saveData.name) || '旅人',
      x: (saveData && saveData.position && saveData.position.x) || sp.x,
      z: (saveData && saveData.position && saveData.position.z) || sp.z,
      facing: Math.PI,          // 世界角度：面向南（屏幕下方）
      vx: 0, vz: 0,
      speed: 7.4,
      hp: 100, maxHp: 100,
      mp: 0, maxMp: 0,
      level: (saveData && saveData.level) || 1,
      exp: (saveData && saveData.exp) || 0,
      expNext: 0,
      gold: (saveData && saveData.gold) || 0,
      atk: 10, def: 2, crit: 0.08, critMult: 1.8,
      attackCd: 0, attackCdMax: 0.42,
      invuln: 0,
      hitFlash: 0,
      dead: false,
      respawnTimer: 0,
      dodge: { cd: 0, cdMax: 1.1, timer: 0, dirX: 0, dirZ: 0, invuln: 0 },
      skills: {},             // id -> {cd}
      skillUnlocked: {},
      equip: { weapon: null, charm: null, robe: null },
      bag: [],
      buffs: [],
      // 战斗时序（给渲染层读）
      attackAnim: 0,
      moveLock: 0
    };
    P.state = st;
    P.recalcStats();
    st.hp = st.maxHp;

    // 初始技能
    st.skillUnlocked[1] = true;
    st.skillUnlocked[2] = true;

    return st;
  };

  /** 根据等级与装备重算属性 */
  P.recalcStats = function () {
    var st = P.state;
    var lv = st.level;
    var baseAtk = 10 + (lv - 1) * 2.2;
    var baseDef = 2 + (lv - 1) * 0.6;
    var baseHp = 100 + (lv - 1) * 18;

    var eq = st.equip;
    var bonus = { atk: 0, def: 0, hp: 0, crit: 0, speed: 0, lifesteal: 0 };
    var slots = ['weapon', 'charm', 'robe'];
    for (var i = 0; i < slots.length; i++) {
      var item = eq[slots[i]];
      if (!item) continue;
      if (item.baseAtk) bonus.atk += item.baseAtk;
      if (item.baseDef) bonus.def += item.baseDef;
      if (item.affixes) {
        for (var a = 0; a < item.affixes.length; a++) {
          var af = item.affixes[a];
          var val = af.value;
          if (af.stat === 'atk') bonus.atk += val;
          else if (af.stat === 'def') bonus.def += val;
          else if (af.stat === 'hp') bonus.hp += val;
          else if (af.stat === 'crit') bonus.crit += val;
          else if (af.stat === 'speed') bonus.speed += val;
          else if (af.stat === 'lifesteal') bonus.lifesteal += val;
        }
      }
    }

    st.atk = Math.round(baseAtk + bonus.atk);
    st.def = Math.round(baseDef + bonus.def);
    st.maxHp = Math.round(baseHp + bonus.hp);
    st.crit = Math.min(0.75, st.critMultBase || 0.08 + bonus.crit);
    st.moveSpeedMul = 1 + bonus.speed;
    st.lifesteal = bonus.lifesteal;
    st.expNext = Math.round(40 * Math.pow(1.28, lv - 1));
    if (st.hp > st.maxHp) st.hp = st.maxHp;
  };

  // =====================================================================
  // 每帧更新
  // =====================================================================
  P.update = function (dt, input, camera) {
    var st = P.state;
    if (!st) return;

    // 死亡
    if (st.dead) {
      st.respawnTimer -= dt;
      if (st.respawnTimer <= 0) P.respawn();
      P.syncVisual(dt, false);
      return;
    }

    // 计时器
    st.invuln = Math.max(0, st.invuln - dt);
    st.attackCd = Math.max(0, st.attackCd - dt);
    st.hitFlash = Math.max(0, st.hitFlash - dt);
    st.moveLock = Math.max(0, st.moveLock - dt);
    st.attackAnim = Math.max(0, st.attackAnim - dt);
    if (st.dodge.cd > 0) st.dodge.cd -= dt;
    if (st.dodge.timer > 0) {
      st.dodge.timer -= dt;
      st.dodge.invuln = Math.max(0, st.dodge.invuln - dt);
    }
    // 技能冷却
    for (var sk in st.skills) {
      if (st.skills[sk].cd > 0) st.skills[sk].cd = Math.max(0, st.skills[sk].cd - dt);
    }
    // buff 计时
    for (var b = st.buffs.length - 1; b >= 0; b--) {
      st.buffs[b].t -= dt;
      if (st.buffs[b].t <= 0) st.buffs.splice(b, 1);
    }
    // 生命自然回复（城镇内更快）
    if (G.world.inTown(st.x, st.z)) {
      st.hp = Math.min(st.maxHp, st.hp + dt * (st.maxHp * 0.06));
    } else {
      st.hp = Math.min(st.maxHp, st.hp + dt * (st.maxHp * 0.012));
    }

    // ---- 输入 ----
    var moving = false;

    // 翻滚中：锁定移动方向
    if (st.dodge.timer > 0) {
      var t = st.dodge.timer / 0.28;
      var sp = st.speed * 2.6 * Math.max(0.25, t);
      st.vx = st.dodge.dirX * sp;
      st.vz = st.dodge.dirZ * sp;
      moving = true;
    } else {
      var ax = input.axis();
      var dir = camera.screenDirToWorld(ax.x, ax.y);
      var mag = Math.sqrt(ax.x * ax.x + ax.y * ax.y);
      if (mag > 0.05) {
        var terr = G.world.terrainSpeed(st.x, st.z);
        var spd = st.speed * (st.moveSpeedMul || 1) * terr;
        st.vx = dir.x * spd;
        st.vz = dir.z * spd;
        st.facing = Math.atan2(dir.x, dir.z);  // 面向移动方向
        moving = true;
      } else {
        st.vx *= Math.pow(0.001, dt);
        st.vz *= Math.pow(0.001, dt);
      }
    }

    // 位移 + 碰撞
    var nx = st.x + st.vx * dt;
    var nz = st.z + st.vz * dt;
    var res = G.world.resolveCollision(nx, nz, 0.34);
    st.x = res.x;
    st.z = res.z;

    // ---- 闪避 ----
    if ((input.pressed.dodge || input.mouse.rightClicked) && st.dodge.cd <= 0 && st.dodge.timer <= 0) {
      P.dodge();
    }

    // ---- 攻击 ----
    if ((input.mouse.down || input.keys.attack) && st.attackCd <= 0 && st.moveLock <= 0) {
      P.basicAttack(input, camera);
    }

    // ---- 技能 ----
    if (input.pressed.skill1) P.useSkill(1, input, camera);
    if (input.pressed.skill2) P.useSkill(2, input, camera);
    if (input.pressed.skill3) P.useSkill(3, input, camera);
    if (input.pressed.skill4) P.useSkill(4, input, camera);

    // ---- 相机旋转 ----
    if (input.pressed.rotateL) camera.rotateStep(1);
    if (input.pressed.rotateR) camera.rotateStep(-1);

    P.syncVisual(dt, moving);
  };

  /** 视觉同步（billboard 朝向、动画、阴影） */
  P.syncVisual = function (dt, moving) {
    var st = P.state;
    var mesh = P.mesh;
    if (!mesh) return;

    mesh.position.x = st.x;
    mesh.position.z = st.z;
    // 死亡时下沉
    mesh.position.y = st.dead ? 0.55 : 1.02;

    // 翻滚时压扁提示
    if (st.dodge.timer > 0) {
      mesh.position.y = 0.78;
    }

    var dir8 = G.sprite.dir8FromAngle(st.facing, G.camera.yaw);
    P.anim.update(dt, moving);
    // 受击/死亡优先
    if (st.dead && P.anim.phase !== 'dead') {
      P.anim.set('dead', 999);
    }
    if (st.hitFlash > 0.12 && !P.anim.locked && !st.dead) {
      P.anim.set('hurt', 0.22);
    }
    if (st.attackAnim > 0 && !P.anim.locked && !st.dead) {
      P.anim.set('attack', 0.24);
    }
    G.sprite.update(mesh, P.atlas, dir8, P.anim.phase, P.anim.frame);

    // 阴影
    P.shadow.position.x = st.x;
    P.shadow.position.z = st.z;
    P.shadow.visible = !st.dead;
    var sc = st.dodge.timer > 0 ? 1.2 : 1;
    P.shadow.scale.setScalar(sc);

    // 受伤闪红（材质颜色）
    var mat = mesh.material;
    if (st.invuln > 0) {
      mat.color.setHex(0xFFFFFF);
      mat.opacity = 0.55 + Math.sin(performance.now() * 0.03) * 0.25;
    } else if (st.hitFlash > 0) {
      mat.color.setHex(0xFFAA99);
      mat.opacity = 1;
    } else {
      mat.color.setHex(0xFFFFFF);
      mat.opacity = 1;
    }
  };

  // =====================================================================
  // 动作
  // =====================================================================
  P.dodge = function () {
    var st = P.state;
    var input = G.input;
    var ax = input.axis();
    var dir = G.camera.screenDirToWorld(ax.x, ax.y);
    if (ax.x === 0 && ax.y === 0) {
      // 无输入则朝当前朝向
      dir = { x: Math.sin(st.facing), z: Math.cos(st.facing) };
    }
    st.dodge.dirX = dir.x;
    st.dodge.dirZ = dir.z;
    st.dodge.timer = 0.28;
    st.dodge.cd = st.dodge.cdMax;
    st.dodge.invuln = 0.25;
    st.invuln = Math.max(st.invuln, 0.25);
    G.bus.emit('sfx', 'dodge');
    // 残影
    G.fx.ghost(st.x, st.z, P.atlas, st.facing, 'walk', 1);
  };

  P.basicAttack = function (input, camera) {
    var st = P.state;
    st.attackCd = st.attackCdMax;
    st.attackAnim = 0.24;
    st.moveLock = 0.16;

    // 朝鼠标方向
    var g = camera.screenToGround(input.mouse.x, input.mouse.y);
    var dx = g.x - st.x, dz = g.z - st.z;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.2) {
      st.facing = Math.atan2(dx, dz);
      // 小幅突进
      var dash = Math.min(1.5, len) * 0.28;
      var n = M.norm(dx, dz);
      var res = G.world.resolveCollision(st.x + n.x * dash, st.z + n.z * dash, 0.34);
      st.x = res.x; st.z = res.z;
    }

    var dmg = st.atk * (0.9 + Math.random() * 0.25);
    var crit = Math.random() < st.crit;
    if (crit) dmg *= st.critMult;

    G.combat.slash({
      x: st.x, z: st.z,
      angle: st.facing,
      arc: Math.PI * 0.75,
      radius: 2.3,
      damage: dmg,
      crit: crit,
      source: 'player',
      knockback: 3.2,
      element: 'blade'
    });

    G.player.flashAttackVfx(st.x, st.z, st.facing);
    G.bus.emit('sfx', crit ? 'hit_crit' : 'slash');
    G.camera.shakeAdd(crit ? 0.28 : 0.16, 0.12);
  };

  /** 挥刀特效：一个扇形拖影 */
  P.flashAttackVfx = function (x, z, angle) {
    G.fx.slashArc(x, z, angle, 2.3, Math.PI * 0.75);
  };

  P.useSkill = function (n, input, camera) {
    var st = P.state;
    if (!st.skillUnlocked[n]) {
      G.ui.toast('还未习得这个技能');
      return;
    }
    var def = G.DATA.SKILLS[n];
    if (!def) return;
    var cdState = st.skills[n] || (st.skills[n] = { cd: 0 });
    if (cdState.cd > 0) return;

    // 朝鼠标方向
    var g = camera.screenToGround(input.mouse.x, input.mouse.y);
    var dx = g.x - st.x, dz = g.z - st.z;
    var ang = Math.atan2(dx, dz);
    if (Math.abs(dx) + Math.abs(dz) > 0.3) st.facing = ang;

    var ok = G.skills.cast(n, def, st, ang, { x: g.x, z: g.z });
    if (ok) {
      cdState.cd = def.cooldown;
      G.bus.emit('ui:skillcd', { n: n, cd: def.cooldown, max: def.cooldown });
    }
  };

  // =====================================================================
  // 受击 / 死亡
  // =====================================================================
  P.takeDamage = function (amount, opts) {
    var st = P.state;
    if (st.dead) return 0;
    if (st.invuln > 0 || st.dodge.invuln > 0) return 0;

    opts = opts || {};
    var dmg = Math.max(1, amount * (100 / (100 + st.def * 8)));
    dmg = Math.round(dmg);
    st.hp -= dmg;
    st.hitFlash = 0.28;
    st.invuln = opts.invuln || 0.35;

    G.fx.damageNumber(st.x, 1.6, st.z, dmg, { playerTaking: true });
    G.camera.shakeAdd(0.3, 0.15);
    G.bus.emit('sfx', 'player_hurt');
    G.ui.flashHurt();

    if (st.hp <= 0) {
      st.hp = 0;
      P.die();
    }
    return dmg;
  };

  P.die = function () {
    var st = P.state;
    st.dead = true;
    st.respawnTimer = 1.6;
    P.anim.set('dead', 999);
    G.bus.emit('player:died');
    // 掉落：地上未拾取的东西消失由 pickup 系统处理
    G.loot.dropAll();
    G.ui.toast('你倒下了……回結ノ町醒来', 2600);
  };

  P.respawn = function () {
    var st = P.state;
    var sp = G.DATA.WORLD.spawn;
    st.dead = false;
    st.hp = st.maxHp;
    st.x = sp.x;
    st.z = sp.z;
    st.invuln = 2.0;
    st.dodge.timer = 0;
    P.anim.phase = 'idle';
    P.anim.locked = false;
    G.bus.emit('player:respawn');
    G.ui.toast('你在結ノ町醒来了');
  };

  P.gainExp = function (amount) {
    var st = P.state;
    st.exp += amount;
    while (st.exp >= st.expNext && st.level < 10) {
      st.exp -= st.expNext;
      st.level++;
      P.recalcStats();
      st.hp = st.maxHp;
      G.ui.saveNotice = true;
      G.ui.toast('等级提升！ Lv.' + st.level, 2200);
      G.fx.levelUp(st.x, st.z);
      G.bus.emit('sfx', 'levelup');
      G.bus.emit('player:levelup', st.level);
    }
    if (st.level >= 10) { st.exp = Math.min(st.exp, st.expNext); }
  };

})(window.G = window.G || {});
