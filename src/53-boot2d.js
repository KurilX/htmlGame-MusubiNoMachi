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

      // ---- 5. 隐藏旧的 UI 层与启动遮罩 ----
      //
      // 【踩过的坑：画面画出来了但看不见】
      // #boot 是 HTML 里的启动遮罩（z-index 100），原本由 bootShell() 隐藏。
      // 2D 模式不走 bootShell，所以它一直盖在 canvas 上，
      // 表现为"渲染数据全对、截图却是 loading 页"。
      var ui = document.getElementById('ui');
      if (ui) ui.style.display = 'none';

      var bootMask = document.getElementById('boot');
      if (bootMask) {
        bootMask.style.transition = 'opacity .4s ease';
        bootMask.style.opacity = '0';
        setTimeout(function () {
          if (bootMask.parentNode) bootMask.parentNode.removeChild(bootMask);
        }, 450);
      }

      // 也清掉 errbox（如果有残留）
      var errbox = document.getElementById('errbox');
      if (errbox) errbox.style.display = 'none';

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
