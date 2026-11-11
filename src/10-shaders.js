/* 10-shaders.js — 赛璐璐着色 + 描边后处理
 * 目标：低模 + 2~3 阶色阶 + 深褐描边，做出"二次元轻"的干净大色块
 */
(function (G) {
  'use strict';

  // =====================================================================
  // 1) 赛璐璐材质
  //
  // IMPORTANT（踩过的坑）：最初我自写 ShaderMaterial 做色阶，结果
  //   a) 所有物体只有一种纯色（色阶没生效）
  //   b) 阴影完全不出现（自写 shader 不参与 Three 的 shadow map 管线）
  // 改用 MeshToonMaterial + 阶梯 gradientMap：原生支持阴影 / 雾 / 顶点色，
  // 少写几百行，而且色阶是真的按光照方向分档的。
  //
  // 渐变贴图的构造：N 个 texel，前若干个黑、后面白，NearestFilter 取样 ->
  // 得到 N 阶硬边色阶。这就是"赛璐璐"的全部秘密。
  // =====================================================================

  var _gradCache = {};

  /**
   * 生成阶梯渐变贴图。
   * @param {number} steps 色阶数 2 / 3 / 4
   * @param {number} darkness 暗部亮度 0..1（0.45 = 暗部保留 45% 亮度）
   */
  G.gradientMap = function (steps, darkness) {
    steps = steps || 2;
    darkness = darkness == null ? 0.55 : darkness;
    var key = steps + ':' + darkness;
    if (_gradCache[key]) return _gradCache[key];

    var w = 32;
    var data = new Uint8Array(w * 4);
    for (var i = 0; i < w; i++) {
      var t = i / (w - 1);                       // 0..1 的原始光照值
      var q = Math.floor(t * steps) / (steps - 1); // 量化到 steps 档
      q = Math.min(1, Math.max(0, q));
      // 暗部不要纯黑：从 darkness 抬到 1.0，保住"轻"的调子
      var v = Math.round((darkness + (1 - darkness) * q) * 255);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
    var tex = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    _gradCache[key] = tex;
    return tex;
  };

  /**
   * 创建赛璐璐材质（Toon）。
   * @param {string|number} baseHex
   * @param {object} opt
   *   steps        色阶数（默认 2）
   *   darkness     暗部亮度（默认 0.55，越小越硬）
   *   side         渲染面
   *   transparent / opacity
   *   map          可选贴图
   *   vertexColors 是否有顶点色
   *   emissive     自发光色（纸灯等）
   *   emissiveIntensity
   */
  G.celMaterial = function (baseHex, opt) {
    opt = opt || {};
    var mat = new THREE.MeshToonMaterial({
      color: new THREE.Color(baseHex),
      gradientMap: G.gradientMap(opt.steps != null ? opt.steps : 2,
                                 opt.darkness != null ? opt.darkness : 0.55),
      side: opt.side || THREE.FrontSide,
      transparent: !!opt.transparent,
      opacity: opt.opacity != null ? opt.opacity : 1,
      vertexColors: !!opt.vertexColors
    });
    if (opt.map) {
      mat.map = opt.map;
      mat.map.minFilter = THREE.NearestFilter;
      mat.map.magFilter = THREE.NearestFilter;
    }
    if (opt.emissive != null) {
      mat.emissive = new THREE.Color(opt.emissive);
      mat.emissiveIntensity = opt.emissiveIntensity != null ? opt.emissiveIntensity : 1;
    }
    mat.userData.baseHex = baseHex;
    return mat;
  };

  /** 修改已有赛璐璐材质的基础色（材质复用，不新建对象） */
  G.celSet = function (mat, baseHex) {
    if (!mat || !mat.color) return;
    mat.color.set(baseHex);
    mat.userData.baseHex = baseHex;
  };

  /** 全局色阶切换（调试/风格微调用） */
  G.setCelSteps = function (steps, darkness) {
    var tex = G.gradientMap(steps, darkness);
    MANUALLY.setCelSteps(tex);
  };

  var MANUALLY = {
    setCelSteps: function (tex) {
      G._celGradTex = tex;
    }
  };

  // =====================================================================
  // 2) 描边后处理：Sobel 边缘检测，输出深褐描边色
  //    在 640x360 上跑，1px 描边 = 放大后 3px，锐利
  // =====================================================================
  var POST_VERT = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  var POST_FRAG = [
    'uniform sampler2D tDiffuse;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uTexel;',        // 1/width, 1/height
    'uniform float uOutlineOn;',
    'uniform vec3 uOutlineColor;',
    'uniform float uDepthThreshold;',
    'uniform float uNormalThreshold;',
    'uniform float uDepthPow;',
    'uniform float uNear;',
    'uniform float uFar;',
    'varying vec2 vUv;',

    'float linearDepth(vec2 uv) {',
    '  float z = texture2D(tDepth, uv).x;',
    '  float ndc = z * 2.0 - 1.0;',
    '  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));',
    '}',

    'void main() {',
    '  vec4 base = texture2D(tDiffuse, vUv);',
    '  if (uOutlineOn < 0.5) { gl_FragColor = vec4(base.rgb, 1.0); return; }',

    // 3x3 深度采样
    '  float d00 = linearDepth(vUv + uTexel * vec2(-1.0, -1.0));',
    '  float d10 = linearDepth(vUv + uTexel * vec2( 0.0, -1.0));',
    '  float d20 = linearDepth(vUv + uTexel * vec2( 1.0, -1.0));',
    '  float d01 = linearDepth(vUv + uTexel * vec2(-1.0,  0.0));',
    '  float d21 = linearDepth(vUv + uTexel * vec2( 1.0,  0.0));',
    '  float d02 = linearDepth(vUv + uTexel * vec2(-1.0,  1.0));',
    '  float d12 = linearDepth(vUv + uTexel * vec2( 0.0,  1.0));',
    '  float d22 = linearDepth(vUv + uTexel * vec2( 1.0,  1.0));',

    '  float gx = (d00 + 2.0 * d01 + d02) - (d20 + 2.0 * d21 + d22);',
    '  float gy = (d00 + 2.0 * d10 + d20) - (d02 + 2.0 * d12 + d22);',
    '  float g = sqrt(gx * gx + gy * gy) / max(linearDepth(vUv), 0.001);',

    // 近处弱化、远处强化（远处的物体在像素空间更"平"，需要更粗的判据）
    '  float edge = smoothstep(uDepthThreshold, uDepthThreshold * 2.2, g);',
    '  vec3 col = mix(base.rgb, uOutlineColor, edge);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // 无深度缓冲时（只有颜色）的退化描边：亮度梯度
  var POST_FRAG_COLOR = [
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uTexel;',
    'uniform float uOutlineOn;',
    'uniform vec3 uOutlineColor;',
    'uniform float uLumThreshold;',
    'varying vec2 vUv;',
    'float lum(vec2 uv) {',
    '  vec3 c = texture2D(tDiffuse, uv).rgb;',
    '  return dot(c, vec3(0.299, 0.587, 0.114));',
    '}',
    'void main() {',
    '  vec4 base = texture2D(tDiffuse, vUv);',
    '  if (uOutlineOn < 0.5) { gl_FragColor = vec4(base.rgb, 1.0); return; }',
    '  float gx = (lum(vUv + uTexel * vec2(-1.0, -1.0)) + 2.0 * lum(vUv + uTexel * vec2(-1.0, 0.0)) + lum(vUv + uTexel * vec2(-1.0, 1.0)))',
    '           - (lum(vUv + uTexel * vec2( 1.0, -1.0)) + 2.0 * lum(vUv + uTexel * vec2( 1.0, 0.0)) + lum(vUv + uTexel * vec2( 1.0, 1.0)));',
    '  float gy = (lum(vUv + uTexel * vec2(-1.0, -1.0)) + 2.0 * lum(vUv + uTexel * vec2(0.0, -1.0)) + lum(vUv + uTexel * vec2(1.0, -1.0)))',
    '           - (lum(vUv + uTexel * vec2(-1.0,  1.0)) + 2.0 * lum(vUv + uTexel * vec2(0.0,  1.0)) + lum(vUv + uTexel * vec2(1.0,  1.0)));',
    '  float g = sqrt(gx * gx + gy * gy);',
    '  float edge = smoothstep(uLumThreshold, uLumThreshold * 2.0, g);',
    '  gl_FragColor = vec4(mix(base.rgb, uOutlineColor, edge), 1.0);',
    '}'
  ].join('\n');

  /**
   * 创建后处理材质。
   * @param {boolean} useDepth 是否有深度纹理可用
   */
  G.makePostMaterial = function (useDepth) {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2(1 / G.INTERNAL_W, 1 / G.INTERNAL_H) },
        uOutlineOn: { value: 1.0 },
        uOutlineColor: { value: new THREE.Color(G.PALETTE.inkBrown) },
        uDepthThreshold: { value: 0.022 },
        uNormalThreshold: { value: 0.3 },
        uDepthPow: { value: 1.0 },
        uLumThreshold: { value: 0.16 },
        uNear: { value: 0.1 },
        uFar: { value: 200.0 }
      },
      vertexShader: POST_VERT,
      fragmentShader: useDepth ? POST_FRAG : POST_FRAG_COLOR,
      depthTest: false,
      depthWrite: false
    });
  };

  // 供调试面板读取/写入的描边参数
  G.outlineParams = {
    on: true,
    depthThreshold: 0.022,
    lumThreshold: 0.16
  };

  // 雾色跟随天空色（昼夜会改它）
  G.FOG = {
    set: function (colorHex, near, far) {
      if (G.pixels && G.pixels.postMat) {
        // 描边 pass 不处理雾（场景 pass 已经用 Toon 的雾处理过了）
      }
      G._fogColor = colorHex;
      if (G.world && G.world.scene) {
        G.world.scene.fog = new THREE.Fog(new THREE.Color(colorHex),
          near != null ? near : 26, far != null ? far : 52);
      }
    }
  };

})(window.G = window.G || {});
