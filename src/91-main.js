/* 91-main.js — 引导与主循环
 */
(function (G) {
  'use strict';

  var M = G.M;

  var MAIN = {
    running: false,
    lastTime: 0,
    accumulator: 0,
    elapsed: 0,
    frameCount: 0,
    fps: 60,
    fpsTimer: 0,
    paused: false
  };

  window.GAME = MAIN;

  // =====================================================================
  // 启动
  // =====================================================================
  G.boot = function () {
    var canvas = document.getElementById('gl');
    if (!canvas) { console.error('no canvas'); return; }

    // 渲染器
    G.pixels.init(canvas);
    G.pixels.resize();

    // 相机
    var aspect = G.INTERNAL_W / G.INTERNAL_H;
    G.camera.init(aspect);
    G.camera.resize(aspect);

    // 存档：先看有没有
    G.save.init();
    var slot = G.save.currentSlot();
    var data = G.save.load(slot);

    // 世界
    G.world.build();

    // 玩家
    G.player.init(data);

    // 输入
    G.input.init(canvas);

    // UI
    G.ui.init();

    // 音频
    if (G.audio) G.audio.init();

    // 任务/对话
    if (G.quest) G.quest.init();
    if (G.dlg) G.dlg.init();

    // 新手引导：没有任何进行中/已完成任务时，自动接初始地主线第一章。
    // 这样玩家一进游戏就知道该干什么，不用先去找 NPC 才知道。
    if (G.quest) {
      var hasAny = false;
      for (var qk in G.quest.state.active) { hasAny = true; break; }
      if (!hasAny) {
        for (var dk in G.quest.state.done) { hasAny = true; break; }
      }
      if (!hasAny) {
        G.quest.start('town_01');
        setTimeout(function () {
          G.ui.toast('按 L 查看手账，右上角会提示当前目标', 4200);
        }, 1200);
      }
    }

    // 恢复存档里的世界状态
    if (data && data.world) {
      G.world.timeOfDay = data.world.timeOfDay != null ? data.world.timeOfDay : 0.32;
      if (data.world.knots) {
        data.world.knots.forEach(function (uid) {
          var it = G.world.interactables.find(function (x) { return x.uid === uid; });
          if (it) { it.done = true; }
        });
      }
      if (data.world.opened) {
        data.world.opened.forEach(function (uid) {
          var it = G.world.interactables.find(function (x) { return x.uid === uid; });
          if (it) { it.opened = true; it.broken = true; if (it.obj) it.obj.visible = false; }
        });
      }
    }

    // 事件
    G.bus.on('sfx', function (id) { if (G.audio) G.audio.play(id); });

    // 自动保存时机
    G.bus.on('player:levelup', function () { G.save.save(); });
    G.bus.on('enemy:killed', function () { MAIN._killCount = (MAIN._killCount || 0) + 1; });

    // 首帧渲染
    MAIN.lastTime = performance.now();
    MAIN.running = true;
    requestAnimationFrame(loop);

    window.addEventListener('resize', function () {
      G.pixels.resize();
      G.camera.resize(G.INTERNAL_W / G.INTERNAL_H);
    });

    // 隐藏加载层
    var boot = document.getElementById('boot');
    if (boot) boot.style.display = 'none';

    G.log('booted v' + G.VERSION);
    window.__GAME_READY__ = true;
  };

  // =====================================================================
  // 主循环
  // =====================================================================
  function loop(now) {
    if (!MAIN.running) return;
    requestAnimationFrame(loop);

    var rawDt = (now - MAIN.lastTime) / 1000;
    MAIN.lastTime = now;

    // 防止切后台回来后的巨帧
    if (rawDt > 0.25) rawDt = 0.25;
    if (rawDt < 0) rawDt = 0;

    MAIN.fpsTimer += rawDt;
    MAIN.frameCount++;
    if (MAIN.fpsTimer >= 0.5) {
      MAIN.fps = MAIN.frameCount / MAIN.fpsTimer;
      MAIN.frameCount = 0;
      MAIN.fpsTimer = 0;
    }

    // 固定步长物理
    MAIN.accumulator += rawDt;
    var steps = 0;

    while (MAIN.accumulator >= G.FIXED_DT && steps < 5) {
      var dt = G.FIXED_DT;
      MAIN.accumulator -= dt;
      steps++;

      if (!MAIN.paused) {
        // 关键：hitstop 状态必须每步重新判断。
        // 踩过的大坑：曾经在 while 外面算一次 inHitstop 传进来，
        // 结果第一次命中产生 hitstop 之后，外层变量一直是 true，
        // player.update 被永久跳过 —— 玩家角色从此不再响应任何输入。
        step(dt);
      }
    }

    // 渲染（不做固定步长）
    render(rawDt);

    // 清除"本帧刚按下"
    G.input.endFrame();
  }

  function step(dt) {
    MAIN.elapsed += dt;
    var st = G.player.state;

    // 命中停顿：世界不推进，但输入收集与 UI 仍要跑，
    // 否则 hitstop 期间按下的键会丢
    var frozen = G.hitstop.timer > 0;
    G.hitstop.update(dt);

    if (!frozen) {
      // 玩家
      G.player.update(dt, G.input, G.camera);

      // 技能持续效果
      G.skills.update(dt, st);

      // 敌人
      G.enemy.update(dt, G.player);

      // 投射物
      G.projectiles.update(dt);

      // 世界（昼夜/刷怪/装饰动画）
      G.world.update(dt, MAIN.elapsed);

      // 掉落
      G.loot.update(dt, st);
    }

    // UI 与特效保持更新（不受 hitstop 影响）
    G.fx.update(dt);
    G.ui.update(dt);
    if (G.ui.updateQuestTracker) G.ui.updateQuestTracker();
    // 相机跟随：y 也要跟地形走，否则上坡时角色会跑出画面
    var groundY = G.world.groundY(st.x, st.z);
    G.camera.update(dt, { x: st.x, z: st.z, y: groundY + 0.6 });

    // ---- 到达判定（任务 reach 步骤）----
    // 之前 onReach 只有定义、没有任何调用点，导致所有 reach 步骤永远不完成。
    // 每 0.25 秒检查一次玩家与各"到达点"的距离。
    if (G.quest && G.quest.checkReach) G.quest.checkReach(dt, st);

    // 交互
    if (G.input.pressed.interact) {
      G.interact.tryInteract();
    }

    // 面板
    if (G.input.pressed.inventory) G.ui.togglePanel('inventory');
    if (G.input.pressed.questlog) G.ui.togglePanel('quest');
    if (G.input.pressed.escape) {
      if (G.ui.anyPanelOpen()) { G.ui.closeAllPanels(); }
    }
    if (G.input.pressed.confirm && G.dlg && G.dlg.active) {
      G.dlg.advance();
    }

    // 自动存档：每 30 秒
    MAIN._saveTimer = (MAIN._saveTimer || 0) + dt;
    if (MAIN._saveTimer > 30) {
      MAIN._saveTimer = 0;
      if (!st.dead) G.save.save();
    }
  }

  function render(dt) {
    G.pixels.render(G.world.scene, G.camera.cam);
  }

  /**
   * 供自动化测试/调试用的单步推进。
   * headless 环境下 rAF 会被节流，用它手动跑游戏逻辑。
   *
   * 注意：默认不清空 input.pressed —— 连续推帧时，
   * 第一次推帧消费掉"刚按下"之后，后续帧不该再重复触发。
   * 所以这里由调用方决定（clearInput 默认 true，与真实 rAF 行为一致）。
   *
   * @param {number} dt 秒
   * @param {boolean} clearInput 是否在末尾清空 pressed/clicked
   */
  G.tickOnce = function (dt, clearInput) {
    if (!G.world || !G.player.state) return;
    if (!MAIN.paused) step(dt);
    if (clearInput !== false) G.input.endFrame();
  };

  // =====================================================================
  // 交互（宝箱/碑文/结/采集/商店/NPC）
  // =====================================================================
  var IT = G.interact = {};
  // 交互冷却：防止连按 E 对同一个目标重复触发（读碑文/采集合成一条路径）
  IT._cooldown = 0;
  IT._lastUid = null;

  IT.tryInteract = function () {
    var now = G.main ? G.main.elapsed : performance.now() / 1000;
    if (IT._cooldown > now) return;
    IT._cooldown = now + 0.35;

    var st = G.player.state;
    // 先看 NPC（距离更近的优先）
    var npc = null, npcD = 2.6;
    for (var i = 0; i < G.world.npcs.length; i++) {
      var n = G.world.npcs[i];
      var d = M.dist(st.x, st.z, n.x, n.z);
      if (d < npcD) { npcD = d; npc = n; }
    }
    if (npc) { IT.talkTo(npc); return; }

    var it = G.world.nearestInteractable(st.x, st.z, 2.4);
    if (!it) return;
    IT._lastUid = it.uid;

    switch (it.kind) {
      case 'stele':
        G.ui.toast(it.text, 5000);
        G.fx.pickupBurst(it.x, it.z, '#B8DCE8');
        break;

      case 'chest':
        if (it.opened) return;
        it.opened = true;
        if (it.obj && it.obj.userData.lid) {
          it.obj.userData.lid.rotation.x = -1.1;
        }
        G.loot.openChest(it);
        G.bus.emit('sfx', 'chest');
        break;

      case 'knot':
        if (it.done) { G.ui.toast('这个结已经系好了', 1800); return; }
        it.done = true;
        G.fx.parryFlash(it.x, it.z, 0);
        G.ui.toast('—— 结，系上了。', 2400);
        G.player.gainExp(80);
        st.gold += 40;
        if (G.quest) G.quest.onKnot(it.uid);
        G.bus.emit('sfx', 'knot');
        G.save.save();
        break;

      case 'node':
        IT.gather(it);
        break;

      case 'shrine':
        G.save.save();
        G.ui.toast('参拜完毕 —— 已保存', 2000);
        st.hp = st.maxHp;
        G.fx.parryFlash(it.x, it.z, 0);
        break;

      case 'gate':
        G.ui.toast('（副本将在下一版开放）', 2200);
        break;
    }
  };

  IT.gather = function (it) {
    if (it.remaining <= 0) return;
    it.remaining--;
    var st = G.player.state;
    var itemId = it.nodeType === 'ore' ? 'mat_horn' : 'mat_shell';
    var item = G.inv.instantiate(itemId);
    if (item) G.inv.add(item, 1);
    G.ui.toast('采集到 ' + (G.DATA.ITEMS[itemId] ? G.DATA.ITEMS[itemId].name : '素材'), 1400);
    G.fx.pickupBurst(it.x, it.z, '#7FB069');
    G.bus.emit('sfx', 'gather');
    if (it.remaining <= 0 && it.obj) {
      it.obj.scale.setScalar(0.35);
    }
    G.bus.emit('ui:dirty');
  };

  IT.talkTo = function (npc) {
    var dlgId = npc.def.dialogue;
    // 商人：先对话再开店
    if (npc.def.shop && G.dlg) {
      G.dlg.start(npc, G.DATA.DIALOGUES[dlgId], true);
    } else if (G.dlg) {
      G.dlg.start(npc, G.DATA.DIALOGUES[dlgId]);
    }
  };

  // =====================================================================
  // 启动
  // =====================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { G.boot(); });
  } else {
    G.boot();
  }

  G.main = MAIN;

})(window.G = window.G || {});
