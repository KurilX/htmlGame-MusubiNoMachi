/* _smoke.js — 管线冒烟测试 2：验证 Toon 色阶 + 阴影 + 描边后处理
 */
(function (G) {
  'use strict';

  var canvas = document.getElementById('gl');
  G.pixels.init(canvas);
  G.pixels.resize();

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(G.PALETTE.sky);
  scene.fog = new THREE.Fog(new THREE.Color('#D9E4EA'), 30, 60);

  var camera = new THREE.OrthographicCamera(-13, 13, 7.5, -7.5, 0.1, 100);
  camera.position.set(16, 13, 16);
  camera.lookAt(0, 0, 0);

  // 环境光：别太亮，否则色阶会被压平
  scene.add(new THREE.AmbientLight(0xffffff, 0.72));

  // 主方向光（带阴影）
  var light = new THREE.DirectionalLight(0xfff4e0, 1.35);
  light.position.set(9, 16, 7);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  var d = 16;
  light.shadow.camera.left = -d;
  light.shadow.camera.right = d;
  light.shadow.camera.top = d;
  light.shadow.camera.bottom = -d;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 60;
  light.shadow.bias = -0.0015;
  light.shadow.normalBias = 0.02;
  scene.add(light);
  scene.add(light.target);

  // 地面
  var ground = new THREE.Mesh(
    new THREE.BoxGeometry(32, 1, 32),
    G.celMaterial(G.PALETTE.grass, { steps: 2, darkness: 0.62 })
  );
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);

  var shapes = [
    { g: new THREE.BoxGeometry(2.2, 2.2, 2.2), c: G.PALETTE.sakura },
    { g: new THREE.CylinderGeometry(1, 1, 3.2, 6), c: G.PALETTE.vermilion },
    { g: new THREE.IcosahedronGeometry(1.3, 0), c: G.PALETTE.cream },
    { g: new THREE.ConeGeometry(1.5, 3.2, 5), c: G.PALETTE.mossDark },
    { g: new THREE.TorusKnotGeometry(0.8, 0.32, 32, 6), c: G.PALETTE.skyDeep },
    { g: new THREE.BoxGeometry(1.4, 3.4, 1.4), c: G.PALETTE.earth }
  ];
  for (var i = 0; i < shapes.length; i++) {
    var s = shapes[i];
    var m = new THREE.Mesh(s.g, G.celMaterial(s.c, { steps: 2, darkness: 0.5 }));
    var col = i % 3, row = Math.floor(i / 3);
    m.position.set((col - 1) * 5, 1.6, (row - 0.5) * 5);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  // 纸灯：自发光
  var lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 10, 8),
    G.celMaterial(G.PALETTE.lampGlow, {
      steps: 2, darkness: 0.85,
      emissive: G.PALETTE.lampGlow, emissiveIntensity: 0.85
    })
  );
  lamp.position.set(0, 2.6, 0);
  scene.add(lamp);

  document.getElementById('boot').style.display = 'none';
  G.pixels.renderer.shadowMap.enabled = true;

  var frames = 0;
  function loop() {
    requestAnimationFrame(loop);
    camera.position.x = 16 + Math.sin(frames * 0.006) * 1.5;
    camera.lookAt(0, 0.6, 0);
    G.pixels.render(scene, camera);
    frames++;
    if (frames === 4) {
      window.__SMOKE_OK__ = true;
      window.__SMOKE_INFO__ = {
        scale: G.pixels.scale,
        depth: G.pixels.hasDepthTexture,
        shadows: G.pixels.renderer.shadowMap.enabled
      };
      G.log('smoke2 ok', window.__SMOKE_INFO__);
    }
  }
  loop();
  window.addEventListener('resize', function () { G.pixels.resize(); });

})(window.G = window.G || {});
