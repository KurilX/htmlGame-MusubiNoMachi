/* 12b-celshade.js — 彩色阴影着色
 *
 * 【核心问题说明】
 * 传统 Toon 的暗部用 "基础色 × 系数" 实现，结果：
 *   粉色 × 0.6 = 暗粉（发灰、发脏）
 *   黄色 × 0.6 = 暗黄（变橄榄）
 * 这是"简约/脏"感的主要来源之一。
 *
 * 动画片和插画里，阴影不是"变暗的颜色"，而是"更冷、更饱和的颜色"：
 *   粉色的阴影 -> 偏紫的粉
 *   黄色的阴影 -> 偏橙的褐
 *   白色的阴影 -> 淡蓝紫
 *
 * 所以正确做法是三步：
 *   1) 亮度降低
 *   2) 色相向冷色（蓝紫）偏移
 *   3) 饱和度提升（阴影里颜色反而更浓）
 *
 * 实现：用 onBeforeCompile 注入 MeshToonMaterial 的 fragment shader，
 * 在 gradientMap 采样之后对暗部颜色做 HSL 变换。
 * 这样保留了 Toon 材质对阴影贴图/雾/顶点色的原生支持。
 */
(function (G) {
  'use strict';

  // 阴影色相偏移量（弧度）与饱和度/亮度系数，全局可调
  G.shadeTint = {
    hueShift: -0.06,      // 向蓝紫偏（负值 = 向蓝）
    satBoost: 1.22,       // 阴影饱和度提升
    lightMul: 0.72,       // 阴影亮度
    warmShift: 0.02       // 高光略偏暖
  };

  /**
   * 给 MeshToonMaterial 注入彩色阴影逻辑。
   * @param {THREE.Material} mat
   * @param {object} opt { hueShift, satBoost, lightMul }
   */
  G.applyColoredShade = function (mat, opt) {
    opt = opt || {};
    var hue = opt.hueShift != null ? opt.hueShift : G.shadeTint.hueShift;
    var sat = opt.satBoost != null ? opt.satBoost : G.shadeTint.satBoost;

    mat.userData.coloredShade = { hueShift: hue, satBoost: sat };

    var prevCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = function (shader, renderer) {
      if (prevCompile) prevCompile.call(mat, shader, renderer);

      shader.uniforms.uShadeHue = { value: hue };
      shader.uniforms.uShadeSat = { value: sat };

      // 在 fragment shader 里注入：
      // MeshToonMaterial 的颜色最终在 #include <output_fragment> 之前算好，
      // 我们要拿到"阴影比例"——用 gradientMap 采样得到的光照值近似。
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          [
            'uniform float uShadeHue;',
            'uniform float uShadeSat;',
            // RGB <-> HSL 互转（不依赖外部库）
            'vec3 rgb2hsl(vec3 c) {',
            '  float mx = max(max(c.r, c.g), c.b);',
            '  float mn = min(min(c.r, c.g), c.b);',
            '  float d = mx - mn;',
            '  float h = 0.0;',
            '  if (d > 0.0001) {',
            '    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);',
            '    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;',
            '    else h = (c.r - c.g) / d + 4.0;',
            '    h /= 6.0;',
            '  }',
            '  float l = (mx + mn) * 0.5;',
            '  float s = d < 0.0001 ? 0.0 : d / (1.0 - abs(2.0 * l - 1.0) + 0.0001);',
            '  return vec3(h, s, l);',
            '}',
            'float hue2rgb(float p, float q, float t) {',
            '  if (t < 0.0) t += 1.0;',
            '  if (t > 1.0) t -= 1.0;',
            '  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;',
            '  if (t < 0.5) return q;',
            '  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;',
            '  return p;',
            '}',
            'vec3 hsl2rgb(vec3 hsl) {',
            '  float h = hsl.x, s = hsl.y, l = hsl.z;',
            '  if (s <= 0.0) return vec3(l);',
            '  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;',
            '  float p = 2.0 * l - q;',
            '  return vec3(hue2rgb(p, q, h + 1.0/3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0/3.0));',
            '}',
            'void main() {'
          ].join('\n')
        )
        .replace(
          '#include <output_fragment>',
          [
            // outgoingLight 在这里已经是最终颜色。
            // 我们用它的亮度反推"是不是阴影"：越暗越像阴影。
            'vec3 _col = outgoingLight;',
            'vec3 _hsl = rgb2hsl(_col);',
            // 亮度越低，色相偏移和饱和度提升越强
            'float _shadeAmt = clamp(1.0 - _hsl.z * 1.35, 0.0, 1.0);',
            // 色相向蓝紫偏移（只在阴影处）
            '_hsl.x = fract(_hsl.x + uShadeHue * _shadeAmt);',
            // 阴影里饱和度反而提升（动画片的做法）
            '_hsl.y = clamp(_hsl.y * (1.0 + (uShadeSat - 1.0) * _shadeAmt), 0.0, 1.0);',
            'outgoingLight = hsl2rgb(_hsl);',
            '#include <output_fragment>'
          ].join('\n')
        );

      mat.userData.shader = shader;
    };

    // 材质变了要重编译
    mat.needsUpdate = true;
    return mat;
  };

  /** 全局调整（调试用） */
  G.setShadeTint = function (opt) {
    if (opt.hueShift != null) G.shadeTint.hueShift = opt.hueShift;
    if (opt.satBoost != null) G.shadeTint.satBoost = opt.satBoost;
    if (opt.lightMul != null) G.shadeTint.lightMul = opt.lightMul;
  };

})(window.G = window.G || {});
