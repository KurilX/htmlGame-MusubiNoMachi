/* 10-shaders.js — 赛璐璐材质 + 描边后处理
 *
 * 重要踩坑记录：
 *  1) 自写 ShaderMaterial 做色阶 -> 不参与 Three 的 shadow map，阴影全丢。
 *     改用 MeshToonMaterial + 阶梯 gradientMap，原生支持阴影/雾/顶点色。
 *  2) 渲染到 RT 后直接贴屏 -> 线性色被当 sRGB 显示，粉彩全变暗变脏。
 *     必须在最终 pass 手动 pow(1/2.2)。见 11-pixels.js。
 */
(function (G) {
  'use strict';

  // =====================================================================
  // 1) 赛璐璐材质
  // =====================================================================
  var _gradCache = {};

  /**
   * 生成阶梯渐变贴图（Toon 的 gradientMap）。
   * @param {number} steps 色阶数
   * @param {number} darkness 暗部保留的亮度 0..1（越小越硬、越暗）
   */
  G.gradientMap = function (steps, darkness) {
    steps = steps || 2;
    darkness = darkness == null ? 0.72 : darkness;
    var key = steps + ':' + darkness;
    if (_gradCache[key]) return _gradCache[key];

    var w = 32;
    var data = new Uint8Array(w * 4);
    for (var i = 0; i < w; i++) {
      var t = i / (w - 1);
      var q = Math.floor(t * steps) / Math.max(1, steps - 1);
      q = Math.min(1, Math.max(0, q));
      // 暗部不要压太死：从 darkness 抬到 1.0
      // 踩过：darkness=0.5 时白墙变成灰墙，整个城镇像黄昏
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
   */
  G.celMaterial = function (baseHex, opt) {
    opt = opt || {};
    var mat = new THREE.MeshToonMaterial({
      color: new THREE.Color(baseHex),
      gradientMap: G.gradientMap(
        opt.steps != null ? opt.steps : 2,
        opt.darkness != null ? opt.darkness : 0.72
      ),
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

  /** 修改已有材质的基础色 */
  G.celSet = function (mat, baseHex) {
    if (!mat || !mat.color) return;
    mat.color.set(baseHex);
    mat.userData.baseHex = baseHex;
  };

  // =====================================================================
  // 2) 描边后处理
  // =====================================================================
  var POST_VERT = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  var POST_FRAG_DEPTH = [
    'uniform sampler2D tDiffuse;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uTexel;',
    'uniform float uOutlineOn;',
    'uniform vec3 uOutlineColor;',
    'uniform float uDepthThreshold;',
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

    '  float edge = smoothstep(uDepthThreshold, uDepthThreshold * 2.4, g);',
    '  vec3 col = mix(base.rgb, uOutlineColor, edge);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // 无深度缓冲时的退化路径：亮度梯度
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
    '  float gx = (lum(vUv + uTexel * vec2(-1.0,-1.0)) + 2.0*lum(vUv + uTexel * vec2(-1.0,0.0)) + lum(vUv + uTexel * vec2(-1.0,1.0)))',
    '           - (lum(vUv + uTexel * vec2( 1.0,-1.0)) + 2.0*lum(vUv + uTexel * vec2( 1.0,0.0)) + lum(vUv + uTexel * vec2( 1.0,1.0)));',
    '  float gy = (lum(vUv + uTexel * vec2(-1.0,-1.0)) + 2.0*lum(vUv + uTexel * vec2(0.0,-1.0)) + lum(vUv + uTexel * vec2(1.0,-1.0)))',
    '           - (lum(vUv + uTexel * vec2(-1.0, 1.0)) + 2.0*lum(vUv + uTexel * vec2(0.0, 1.0)) + lum(vUv + uTexel * vec2(1.0, 1.0)));',
    '  float g = sqrt(gx * gx + gy * gy);',
    '  float edge = smoothstep(uLumThreshold, uLumThreshold * 2.0, g);',
    '  gl_FragColor = vec4(mix(base.rgb, uOutlineColor, edge), 1.0);',
    '}'
  ].join('\n');

  G.makePostMaterial = function (useDepth) {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2(1 / G.INTERNAL_W, 1 / G.INTERNAL_H) },
        uOutlineOn: { value: 1.0 },
        uOutlineColor: { value: new THREE.Color(G.PALETTE.inkBrown) },
        uDepthThreshold: { value: 0.045 },
        uLumThreshold: { value: 0.14 },
        uNear: { value: 0.1 },
        uFar: { value: 200.0 }
      },
      vertexShader: POST_VERT,
      fragmentShader: useDepth ? POST_FRAG_DEPTH : POST_FRAG_COLOR,
      depthTest: false,
      depthWrite: false
    });
  };

  // 描边参数（外部可调）
  //
  // depthThreshold 的调参史（很重要，别随手改小）：
  //   0.010 ~ 0.016  细长物体（竹竿、灯柱）整根被判定成边缘 -> 渲染成黑线。
  //                  原因是 640x360 下竹竿只有 3~4 像素宽，深度梯度天然很大。
  //   0.045          实测最优：轮廓清晰、细物体保色。
  //   0.070+         边缘开始漏判，物体轮廓变淡。
  G.outlineParams = {
    on: true,
    depthThreshold: 0.045,
    lumThreshold: 0.14
  };

})(window.G = window.G || {});
