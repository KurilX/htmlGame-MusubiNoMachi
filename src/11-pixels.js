/* 11-pixels.js — 640x360 低分辨率渲染管线 + nearest 放大 + 描边后处理
 * 流程：场景 -> RT(640x360, RGBA + Depth) -> 描边 pass -> 屏幕（nearest，整数倍）
 */
(function (G) {
  'use strict';

  var P = G.pixels = {
    renderer: null,
    sceneRT: null,      // 场景渲染目标（低分辨率）
    outputRT: null,     // 后处理输出
    postMat: null,
    quadScene: null,
    quadCam: null,
    quad: null,
    scale: 1,
    hasDepthTexture: false
  };

  P.init = function (canvas) {
    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: false,          // 像素风：绝不能开抗锯齿
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });
    renderer.setPixelRatio(1);   // 自己控制
    renderer.autoClear = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    P.renderer = renderer;
    P.hasDepthTexture = !!renderer.capabilities.isWebGL2;

    // 场景渲染目标
    var rtOpts = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false
    };
    if (P.hasDepthTexture) {
      rtOpts.depthTexture = new THREE.DepthTexture(G.INTERNAL_W, G.INTERNAL_H);
      rtOpts.depthTexture.format = THREE.DepthFormat;
      rtOpts.depthTexture.type = THREE.UnsignedIntType;
    }
    P.sceneRT = new THREE.WebGLRenderTarget(G.INTERNAL_W, G.INTERNAL_H, rtOpts);
    P.sceneRT.texture.minFilter = THREE.NearestFilter;
    P.sceneRT.texture.magFilter = THREE.NearestFilter;

    // 后处理目标（同样低分辨率）
    P.outputRT = new THREE.WebGLRenderTarget(G.INTERNAL_W, G.INTERNAL_H, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    });

    // 全屏四边形
    P.postMat = G.makePostMaterial(P.hasDepthTexture);
    P.quadScene = new THREE.Scene();
    P.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var geo = new THREE.PlaneGeometry(2, 2);
    P.quad = new THREE.Mesh(geo, P.postMat);
    P.quad.frustumCulled = false;
    P.quadScene.add(P.quad);

    if (P.hasDepthTexture) {
      P.postMat.uniforms.tDepth.value = P.sceneRT.depthTexture;
    }
    P.postMat.uniforms.tDiffuse.value = P.sceneRT.texture;

    G.log('renderer ready, webgl2=' + P.hasDepthTexture);
    return renderer;
  };

  /** 调整画布尺寸：保持 16:9，最近整数倍放大 */
  P.resize = function () {
    if (!P.renderer) return;
    var w = window.innerWidth, h = window.innerHeight;
    // 保持 16:9，留黑边
    var targetAspect = 16 / 9;
    var aspect = w / h;
    var cw, ch;
    if (aspect > targetAspect) {
      ch = h; cw = Math.round(h * targetAspect);
    } else {
      cw = w; ch = Math.round(w / targetAspect);
    }
    // 缩放策略。
    //
    // 内部分辨率提到 1152x648 后，实际显示器很少能有 2 倍以上的整数倍空间
    // （1080p 上只有 1.67 倍），所以这里改成：
    //   - 优先取能整除的整数倍（>=1）
    //   - 若整数倍导致画面明显小于窗口（>15% 空隙），改用浮点倍填满
    // 浮点缩放时 imageRendering:pixelated 仍会保持硬边，
    // 不会像以前那样出现"只占屏幕一角"。
    var s = Math.max(1, Math.floor(cw / G.INTERNAL_W));
    var dispW = Math.round(G.INTERNAL_W * s);
    var dispH = Math.round(G.INTERNAL_H * s);
    if (dispW < cw * 0.85) {
      s = cw / G.INTERNAL_W;
      dispW = cw;
      dispH = Math.round(G.INTERNAL_H * s);
    }
    var canvas = P.renderer.domElement;
    canvas.width = G.INTERNAL_W;
    canvas.height = G.INTERNAL_H;
    canvas.style.width = dispW + 'px';
    canvas.style.height = dispH + 'px';
    // 居中
    canvas.style.position = 'absolute';
    canvas.style.left = Math.floor((w - dispW) / 2) + 'px';
    canvas.style.top = Math.floor((h - dispH) / 2) + 'px';
    canvas.style.imageRendering = 'pixelated';
    P.scale = s;
    P.renderer.setSize(G.INTERNAL_W, G.INTERNAL_H, false);
    return { s: s, dispW: dispW, dispH: dispH };
  };

  /**
   * 渲染一帧。
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  P.render = function (scene, camera) {
    var r = P.renderer;
    if (!r) return;

    // 1) 场景 -> sceneRT
    r.setRenderTarget(P.sceneRT);
    r.clear(true, true, true);
    r.render(scene, camera);

    // 2) 描边 pass -> outputRT
    var u = P.postMat.uniforms;
    u.uOutlineOn.value = G.outlineParams.on ? 1.0 : 0.0;
    if (P.hasDepthTexture) {
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uDepthThreshold.value = G.outlineParams.depthThreshold;
    } else {
      u.uLumThreshold.value = G.outlineParams.lumThreshold;
    }
    // 雾的远端微调（描边在雾里不该太强）
    r.setRenderTarget(P.outputRT);
    r.clear(true, true, true);
    r.render(P.quadScene, P.quadCam);

    // 3) 输出到屏幕（保留像素感）
    var prevTarget = r.getRenderTarget();
    r.setRenderTarget(null);
    // 直接把 outputRT 贴到屏幕
    var tmpMat = P._screenMat;
    if (!tmpMat) {
      tmpMat = P._screenMat = new THREE.ShaderMaterial({
        uniforms: { tex: { value: P.outputRT.texture } },
        vertexShader: [
          'varying vec2 vUv;',
          'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
        ].join('\n'),
        fragmentShader: [
          'uniform sampler2D tex;',
          'varying vec2 vUv;',
          'void main(){',
          '  vec3 c = texture2D(tex, vUv).rgb;',
          // 关键：RT 里是线性色，输出到屏幕必须手动转 sRGB，
          // 否则粉彩会全部变暗变脏（踩过：樱粉渲成灰紫）
          '  c = pow(c, vec3(1.0 / 2.2));',
          '  gl_FragColor = vec4(c, 1.0);',
          '}'
        ].join('\n'),
        depthTest: false, depthWrite: false
      });
      var q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tmpMat);
      q.frustumCulled = false;
      var s = new THREE.Scene(); s.add(q);
      P._screenScene = s;
    }
    // 全屏四边形的正交相机
    if (!P._fullCam) P._fullCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    r.render(P._screenScene, P._fullCam);
    r.setRenderTarget(prevTarget);
  };

  // ---------- 像素级离屏 canvas（供程序化贴图与立绘使用） ----------
  G.makeCanvas = function (w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return c;
  };

  /** 把 canvas 转成 THREE 纹理（nearest，不生成 mipmap） */
  G.canvasTexture = function (canvas, repeat) {
    var t = new THREE.CanvasTexture(canvas);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
    }
    return t;
  };

  /** 把 canvas 转 data URI（用于 CSS 背景/图标） */
  G.canvasToDataURL = function (canvas) {
    try { return canvas.toDataURL('image/png'); } catch (e) { return ''; }
  };

})(window.G = window.G || {});
