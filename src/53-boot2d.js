/* 53-boot2d.js — 2D 模式启动器
 *
 * 【职责】
 *   把 Canvas2D 渲染层 + 瓦片图集 + 2D 世界串起来，
 *   接管主循环，完全绕开 three.js。
 *
 * 【怎么启用】
 *   game.html?mode=2d
 *
 * 【为什么独立一个文件而不改 91-main.js】
 * 旧主循环绑定 three.js 的 scene/camera/pixels，改动面太大。
 * 2D 模式用**自己的循环**，与旧循环并列，互不干扰。
 * 等 2D 版验证通过后，再决定是否整体切换。
 */
(function (G) {
  'use strict';

  var B = G.boot2d = {};

  B.running = false;
  B.lastTime = 0;
  B.errors = [];

  /**
   * 启动 2D 模式。
   * @returns {Promise<boolean>}
   */
  B.start = function () {
    // ---- 1. 加载图集 ----
    if (G.loading) {
      G.loading.build();
      G.loading.setMessage('加载瓦片图集…');
    }

    return G.tiles16.load(function (done, total, name) {
      if (G.loading) G.loading.setProgress(done, total, name);
    }).then(function (ok) {
      if (!ok) throw new Error('图集加载失败');

      // ---- 2. 初始化渲染层 ----
      var canvas = document.getElementById('gl');
      if (!canvas) throw new Error('找不到 canvas');
      if (!G.render2d.init(canvas)) throw new Error('render2d 初始化失败');

      // ---- 3. 构建地图 ----
      G.world2d.buildTown();

      // ---- 4. 相机对准玩家 ----
      var p = G.world2d.player;
      G.render2d.camFollow(p.x, p.y, true);

      // ---- 5. 隐藏启动遮罩，但**保留 UI 层** ----
      //
      // 【踩过的坑：UI 全丢了】
      // 第一版在这里写了 `ui.style.display = 'none'`，把整个 HUD 关掉了 ——
      // 用户进游戏看到的是"只有地图，没有血条、没有技能栏、没有任务提示"。
      //
      // 实际上 #ui 是 HUD 层（血条/技能栏/任务追踪/小地图），
      // 2D 模式**仍然需要它**，只是它上面的坐标/血量数据来自 3D 的 player 模块。
      // 所以这里改成：保留 #ui，只把启动遮罩 #boot 淡出。
      //
      // 【另一个坑】#boot 是 z-index 100 的启动遮罩，原本由 bootShell() 隐藏。
      // 2D 模式不走 bootShell，所以它一直盖在 canvas 上，
      // 表现为"渲染数据全对、截图却是 loading 页"。
      var ui = document.getElementById('ui');
      if (ui) {
        ui.style.display = '';       // 确保是显示状态
        ui.style.zIndex = '10';
      }

      var bootMask = document.getElementById('boot');
      if (bootMask) {
        bootMask.style.transition = 'opacity .4s ease';
        bootMask.style.opacity = '0';
        setTimeout(function () {
          if (bootMask.parentNode) bootMask.parentNode.removeChild(bootMask);
        }, 450);
      }

      // errbox 是错误浮层，没有错误时不显示
      var errbox = document.getElementById('errbox');
      if (errbox) errbox.style.display = 'none';

      // ---- 5b. 角色外观预合成 ----
      //
      // 原素材是裸模（光头白身）。G.charSkin 会为每个外观合成
      // 一整张四向图集（4 行 × 7 帧 = 28 帧），启动时做一次，
      // 运行时只查表取帧。
      if (G.charSkin) {
        try {
          G.charSkin.prewarm();
          console.log('[boot2d] 角色外观已预合成: ' +
            Object.keys(G.charSkin._cache).join(','));
        } catch (e) {
          console.warn('[boot2d] 外观合成失败:', e && e.message);
        }
      }

      // ---- 5c. 初始化 HUD ----
      //
      // UI 模块（70-ui.js）依赖 G.player.state 渲染血条/等级。
      // 2D 模式没有 3D 的 player 模块，用 G.hud2d 造一个最小替身，
      // 让现有 HUD 直接可用，不必改 70-ui.js（3D 路线还在用）。
      if (G.hud2d) {
        try {
          G.hud2d.init();
          console.log('[boot2d] HUD 已初始化');
        } catch (e) {
          console.warn('[boot2d] HUD 初始化失败:', e && e.message);
        }
      } else if (G.ui && !G.ui.root) {
        try { G.ui.init(); } catch (e) {
          console.warn('[boot2d] UI 初始化失败:', e && e.message);
        }
      }

      // ---- 6. 启动循环 ----
      B.running = true;
      B.lastTime = performance.now();
      requestAnimationFrame(B.loop);

      window.addEventListener('resize', function () {
        if (G.render2d) G.render2d.resize();
      });

      if (G.loading) G.loading.hide();

      window.__GAME_READY__ = true;
      console.log('[boot2d] 就绪 ' + JSON.stringify(G.world2d.info()));
      return true;
    });
  };

  B.loop = function (now) {
    if (!B.running) return;
    requestAnimationFrame(B.loop);

    var dt = (now - B.lastTime) / 1000;
    B.lastTime = now;
    if (dt > 0.1) dt = 0.1;   // 防止切后台回来的巨帧
    if (dt < 0) dt = 0;

    try {
      G.world2d.update(dt, G.input);
      G.render2d.camUpdate(dt);
      G.world2d.draw();

      // HUD 每帧刷新（血条/等级/任务追踪）
      if (G.hud2d) G.hud2d.update(dt);
    } catch (e) {
      // 避免每帧刷屏
      if (B.errors.length < 5) {
        B.errors.push(String(e && e.message ? e.message : e));
        console.error('[boot2d]', e);
      }
    }
  };

  B.stop = function () {
    B.running = false;
  };

})(window.G = window.G || {});
