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
  // 启动（拆成两段）
  //
  // 【为什么拆】
  // 原来 G.boot() 一次做完全部初始化，加载完就直接进场景：
  // 想改设置、想换存档、想看有没有别的存档，都没有入口。
  // 而且 world.build() 实测要 966ms，点一下「设置」也得等它建完。
  //
  // 拆成：
  //   bootShell()  渲染器 + 相机 + 输入 + 音频 + 主菜单   ← 立刻可用
  //   startGame()  构建世界 + 玩家 + UI + 开场          ← 点了菜单才跑
  // =====================================================================

  G.boot = function () {
    // =====================================================================
    // 【2D 模式分流】
    //
    // ?mode=2d 走**完全独立**的 Canvas 2D 渲染管线：
    //   不建 three.js 场景、不用 WebGL、不用正交相机。
    // 这条路线是为了彻底摆脱"3D 引擎 + 像素贴图"导致的
    // 图层穿透 / 角色消失 / 纹理混乱。
    //
    // 不带参数时仍走原来的 3D 路线，互不影响。
    // =====================================================================
    var use2d = false;
    try {
      var q2 = new URLSearchParams(window.location.search);
      use2d = (q2.get('mode') === '2d');
    } catch (e) { use2d = false; }

    if (use2d && G.boot2d) {
      // 2D 模式需要 input 先初始化（读键盘）
      var canvas2 = document.getElementById('gl');
      if (canvas2 && G.input) G.input.init(canvas2);
      G.boot2d.start().catch(function (err) {
        console.error('[boot] 2D 启动失败:', err);
        if (G.loading) {
          G.loading.setMessage('2D 启动失败: ' + (err && err.message ? err.message : err));
        }
      });
      return;
    }

    // =====================================================================
    // 【加载页】
    //
    // 素材包（assets/pack/）需要先从磁盘读进来，这期间不能立壳 ——
    // 否则会先看到程序化贴图的画面闪一下再跳变。
    //
    // 流程：
    //   1) 显示 loading 页
    //   2) 加载 manifest + 全部贴图（进度条实时更新）
    //   3) file:// 时给出明确提示，然后走降级路径
    //   4) 淡出 loading，立壳
    // =====================================================================
    var needsLoading = false;
    try {
      var ql = new URLSearchParams(window.location.search);
      // 默认就加载素材包；?nopack=1 可强制关闭
      needsLoading = (ql.get('nopack') !== '1');
    } catch (e) { needsLoading = true; }

    if (!needsLoading || !G.assets || !G.loading) {
      G.bootShell();
      return;
    }

    G.loading.build();

    if (!G.assets.canLoadExternal()) {
      // file:// 下加载不了外部贴图，明确告知而不是黑屏
      G.loading.showFileProtocolNote();
      G.loading.setMessage('file:// 模式：使用程序化贴图');
      // 留 1.4 秒让人看清提示
      setTimeout(function () {
        G.loading.hide(function () { G.bootShell(); });
      }, 1400);
      return;
    }

    G.assets.load().then(function () {
      if (G.assets.hasPack()) {
        G.loading.setMessage('素材包就绪');
      } else {
        G.loading.setMessage('素材包加载失败，使用程序化贴图');
        console.warn('[boot] 素材包不可用:', G.assets.error);
      }
      setTimeout(function () {
        G.loading.hide(function () { G.bootShell(); });
      }, 250);
    });
  };

  /** 第一阶段：把壳立起来，显示主菜单 */
  G.bootShell = function () {
    var canvas = document.getElementById('gl');
    if (!canvas) { console.error('no canvas'); return; }

    // 渲染器
    //
    // 【画质】内部分辨率可以由设置决定。
    // 注意：这个值在 pixels.init 时就固化成离屏 RT 的尺寸了，
    // 所以切画质必须重建渲染器 —— 这里只在启动时读一次。
    if (G.menu && G.menu.qualitySize) {
      var qs = G.menu.qualitySize();
      G.INTERNAL_W = qs.w;
      G.INTERNAL_H = qs.h;
    }
    G.pixels.init(canvas);
    G.pixels.resize();

    // 相机
    var aspect = G.INTERNAL_W / G.INTERNAL_H;
    G.camera.init(aspect);
    G.camera.resize(aspect);

    // 存档元数据（主菜单要读）
    G.save.init();

    // 输入：先绑定到 canvas，但菜单期间禁用游戏输入
    G.input.init(canvas);

    // 音频
    if (G.audio) G.audio.init();
    // 应用已保存的音量
    if (G.menu) G.menu._setVol(G.menu._getVol());

    // 全局事件只注册一次
    G.bus.on('sfx', function (id) { if (G.audio) G.audio.play(id); });
    G.bus.on('player:levelup', function () { if (G.player && G.player.state) G.save.save(); });
    G.bus.on('enemy:killed', function () { MAIN._killCount = (MAIN._killCount || 0) + 1; });

    window.addEventListener('resize', function () {
      G.pixels.resize();
      G.camera.resize(G.INTERNAL_W / G.INTERNAL_H);
    });

    // 隐藏加载层
    var boot = document.getElementById('boot');
    if (boot) boot.style.display = 'none';

    // 主菜单
    if (G.menu) {
      // 【自动化测试入口】
      //
      // 加载后自动进入游戏，跳过菜单。三种触发方式：
      //   ?autostart=1        —— 显式指定（测试脚本用）
      //   ?slot=N             —— 直接读某个存档进游戏
      //
      // 为什么需要它：9 个既有验收脚本全都假设"加载完即在场景里"，
      // 主菜单会打断它们。与其改 9 个脚本各自点一遍菜单，
      // 不如给一个统一的跳过入口 —— 菜单本身的行为
      // 由 verify-menu.js 专门覆盖。
      var skip = G.menu.parseAutostart ? G.menu.parseAutostart() : null;
      if (skip) {
        G.menu.hide();
        G.startGame(skip);
      } else {
        G.menu.show();
      }
    }

    // 菜单模式下也要渲染（否则画布是黑的）
    MAIN.lastTime = performance.now();
    MAIN.running = true;
    requestAnimationFrame(loop);

    G.log('shell ready v' + G.VERSION);
    window.__SHELL_READY__ = true;
  };

  /**
   * 第二阶段：真正进入游戏。
   * @param {{slot:number, isNew:boolean, data:object}} opt
   */
  G.startGame = function (opt) {
    opt = opt || {};
    var slot = opt.slot || G.save.currentSlot();
    G.save.setSlot(slot);

    var data = opt.data || (opt.isNew ? null : G.save.load(slot));

    // 世界（第一次构建；从菜单重复进入时重建）
    if (G.world.scene) {
      G.world.dispose ? G.world.dispose() : null;
    }
    G.world.build();

    // ---- 像素风切片（?style=pixel）----
    //
    // 用户希望改成 RPG Maker 那种 2D 俯视像素风。
    // 完整重写约 4400 行风险太大，所以先做一个**可试玩的切片**：
    // 用俯视贴图平面重建一个小场景，让用户先确认观感。
    //
    // 通过 URL 参数启用，不影响默认（等距 3D）体验：
    //   ?style=pixel              像素切片
    //   ?autostart=1&style=pixel  直接进入
    // ---- 外部素材包场景 ----
    //
    // 【为什么有两条分支】
    //   style=pack   → 用下载的成熟素材包（assets/pack/），需 HTTP
    //   style=pixel  → 上一版的自绘像素切片（保留，作为素材包不可用时的对照）
    //
    // 素材包是用户要求的正式路线；自绘那版明确被否决了，但先留着不删，
    // 等素材包版本确认可用后再清理。
    var styleMode = null;
    try {
      var qp = new URLSearchParams(window.location.search);
      styleMode = qp.get('style');
    } catch (e) { styleMode = null; }

    // 默认：如果有素材包就用素材包（这是新的主路线）
    if (!styleMode && G.assets && G.assets.hasPack()) styleMode = 'pack';

    var sliceScene = null;

    if (styleMode === 'pack' && G.assets && G.assets.hasPack() && G.packScene) {
      var packScene = G.packScene.build();
      if (packScene) {
        G.world.scene = packScene;
        G.world.inDungeon = false;
        G.world.pixelSlice = true;        // 复用：跳过原世界的刷怪刷新
        G.world.packMode = true;
        if (G.pixelMode) G.pixelMode.on();
        sliceScene = packScene;
        G.log && G.log('[style] 使用外部素材包');
      }
    } else if (styleMode === 'pixel' && G.pixelScene && G.pixelArt) {
      sliceScene = G.pixelScene.buildSlice();
      if (sliceScene) {
        G.world.scene = sliceScene;
        G.world.inDungeon = false;
        G.world.pixelSlice = true;
        if (G.pixelMode) G.pixelMode.on();
        G.log && G.log('[style] 使用自绘像素切片');
      }
    }

    // 玩家
    G.player.init(data);

    // 【素材包模式下要清掉旧世界的角色】
    //
    // 问题：player.init() 会把玩家 mesh 加进 G.world.scene，
    // 而此时 scene 已经换成素材包场景了 —— 于是原版玩家
    // （512×1248 的 8 方向图集）就叠在新场景里。
    // NPC 同理（buildNPCs 在 world.build 里执行过）。
    //
    // 这些旧元素在素材包画面里完全不该出现，必须移除。
    if (styleMode === 'pack' && G.world.packMode) {
      var stale = [];
      G.world.scene.traverse(function (o) {
        if (!o.isMesh || !o.material || !o.material.map) return;
        var img = o.material.map.image;
        // 原版图集是 512×1248（8 方向 × 13 帧）
        if (img && img.width === 512 && img.height === 1248) stale.push(o);
        // 原版玩家的阴影是 CircleGeometry 的半透明黑
        if (o.geometry && o.geometry.type === 'CircleGeometry') stale.push(o);
      });
      stale.forEach(function (o) { if (o.parent) o.parent.remove(o); });
      // NPC 列表也清空，避免逻辑层还在更新它们
      if (G.world.npcs) G.world.npcs.length = 0;
      if (G.player.mesh) G.player.mesh.visible = false;
      G.log && G.log('[style] 清理旧角色 mesh: ' + stale.length + ' 个');
    }

    // 【顺序很重要】把玩家起点放到切片中央，必须在 player.init 之后 ——
    // player.init 之前 G.player.state 还是 null，直接赋值会抛
    // "Cannot set properties of null (setting 'x')"，整个 startGame 中断，
    // 表现为 UI 没初始化、__GAME_READY__ 永远不置位。
    if (sliceScene && G.player.state) {
      G.player.state.x = 0;
      G.player.state.z = 0;
      G.player.state.vx = 0;
      G.player.state.vz = 0;
    }

    // UI（构造函数幂等，这里确保存在）
    if (!G.ui.root) G.ui.init();

    // 任务/对话
    if (G.quest) G.quest.init();
    if (G.dlg) G.dlg.init();

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

    // 开场（只有全新存档才播）
    if (G.intro) {
      G.intro.reset();
      // 【不要在开局直接塞任务】
      // 之前这里写 `G.quest.start('town_01')` —— 玩家一睁眼就多个任务、
      // 没开场、没见过 NPC。等于把 RPG 的入口砍掉了。
      // 现在走 G.intro：旁白 → 引导去找千絵 → 对话结束才由剧情带出任务。
      if (opt.isNew || G.intro.shouldPlay()) {
        G.intro.playOpening();
      } else if (G.quest && !opt.isNew) {
        setTimeout(function () {
          G.ui.toast('按 L 查看手账，右上角显示当前目标', 3600);
        }, 1200);
      }
    }

    if (G.menu) G.menu.enteredGame = true;

    // 确保主循环在跑
    if (!MAIN.running) {
      MAIN.lastTime = performance.now();
      MAIN.running = true;
      requestAnimationFrame(loop);
    }

    G.save.save(slot);
    window.__GAME_READY__ = true;
  };

  /** 停主循环（回主菜单时用） */
  MAIN.stop = function () {
    MAIN.running = false;
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

      // 菜单打开且未进入游戏时，不推进游戏逻辑。
      // 世界可能还不存在（world.build 尚未调用），step() 里到处访问
      // G.world.scene / G.player.state 会炸。
      var inMenu = G.menu && G.menu.visible && !G.menu.enteredGame;

      if (!MAIN.paused && !inMenu) {
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

      // NPC 浮标：上下浮动 + 始终面向相机
      if (G.world.updateNPCs) G.world.updateNPCs(dt, G.camera.yaw);

      // 像素风画面：角色行走动画
      //
      // 两条分支共用 pixelSlice 标记：
      //   packMode  → 外部素材包场景（18-pack-scene.js）
      //   否则      → 自绘像素切片（15-pixel-scene.js）
      if (G.world.pixelSlice) {
        if (G.world.packMode && G.packScene && G.packScene.update) {
          G.packScene.update(dt);
        } else if (G.pixelScene && G.pixelScene.update) {
          G.pixelScene.update(dt, st);
        }
      }

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

    // ---- 地区进入提示 ----
    // 第一次走进有主线的地区时，提示"去和谁说话"，帮助玩家发现新主线。
    if (G.quest && G.quest.tickRegion) G.quest.tickRegion(dt, st);

    // ---- 开场引导 ----
    // 阶段 2 时检测玩家是否走到千絵面前，到了自动触发对话。
    if (G.intro && G.intro.update) G.intro.update(dt, st);

    // ---- 副本推进 ----
    if (G.dungeon && G.dungeon.active) {
      G.dungeon.update(dt, st);
      // 走进出口传送门就离开
      if (G.dungeon.atExit(st)) {
        G.dungeon.leave();
      }
    }

    // 交互
    if (G.input.pressed.interact) {
      G.interact.tryInteract();
    }

    // 面板
    if (G.input.pressed.inventory) G.ui.togglePanel('inventory');
    if (G.input.pressed.questlog) G.ui.togglePanel('quest');
    if (G.input.pressed.escape) {
      // Esc 的优先级：关面板 > 关对话 > 返回主菜单
      if (G.dlg && G.dlg.active) {
        G.dlg.close();
      } else if (G.ui.anyPanelOpen()) {
        G.ui.closeAllPanels();
      } else if (G.menu && G.menu.showFromGame) {
        // 没有面板/对话时才允许退出到主菜单，避免误触
        G.menu.showFromGame();
      }
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
    // 菜单模式下世界还没构建（或是空的），不能渲染游戏画面。
    // 菜单有自己的 DOM 背景，这里直接清屏即可。
    if (!G.world || !G.world.scene || (G.menu && G.menu.visible && !G.menu.enteredGame)) {
      if (G.pixels && G.pixels.renderer) {
        G.pixels.renderer.setClearColor(0x0A0810, 1);
        G.pixels.renderer.clear();
      }
      return;
    }
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

      case 'gate': {
        // 副本入口：按 gateUid 找到对应的副本定义
        var dgId = null;
        var allDg = G.DATA.DUNGEONS || {};
        for (var dk in allDg) {
          if (allDg[dk].gateUid === it.uid) { dgId = dk; break; }
        }
        if (!dgId) {
          G.ui.toast('（这扇门后面什么也没有）', 2200);
          break;
        }
        if (G.dungeon && G.dungeon.active) {
          G.ui.toast('你已经在里面了', 1600);
          break;
        }
        if (G.dungeon) G.dungeon.enter(dgId);
        break;
      }
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
