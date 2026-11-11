/* 00-core.js — 命名空间、工具、RNG、事件总线
 * 结ノ町 / Musubi no Machi
 * 所有模块挂在全局 G 上，classic script 加载，兼容 file://
 */
(function (G) {
  'use strict';

  // ---------- 基础常量 ----------
  G.VERSION = '0.1.0';
  // 内部渲染分辨率。
  //
  // 分辨率迭代记录（这是整个渲染管线的核心参数）：
  //   640x360  —— 经典低分辨率像素风。角色只有约 37px 高，
  //               5.5 头身时每个头只有 6.7px，五官完全不可能画出来。
  //   1152x648 —— 现在用的。角色约 70px 高，五官/衣褶/材质都能表达。
  //               代价是"像素味"变淡，更接近"高清低模 + 描边"，
  //               但这正是风格参考图的实际做法。
  //
  // 注意：改这个值后必须同步调 10-shaders.js 里的 outlineParams.depthThreshold，
  //       因为描边阈值是按像素尺度定义的（分辨率翻倍，梯度也翻倍）。
  G.INTERNAL_W = 1152;
  G.INTERNAL_H = 648;
  G.TILE = 1;           // 1 world unit = 1 "tile"
  G.FIXED_DT = 1 / 60;  // 固定步长

  // ---------- 数学 ----------
  var M = G.M = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    clamp01: function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    smoothstep: function (t) { t = M.clamp01(t); return t * t * (3 - 2 * t); },
    dist2: function (ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; },
    dist: function (ax, az, bx, bz) { return Math.sqrt(M.dist2(ax, az, bx, bz)); },
    len: function (x, z) { return Math.sqrt(x * x + z * z); },
    norm: function (x, z) {
      var l = Math.sqrt(x * x + z * z);
      return l > 1e-6 ? { x: x / l, z: z / l } : { x: 0, z: 0 };
    },
    angle: function (dx, dz) { return Math.atan2(dz, dx); },
    // 角度最短差
    angleDelta: function (a, b) {
      var d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    },
    approach: function (cur, target, maxDelta) {
      var d = target - cur;
      if (Math.abs(d) <= maxDelta) return target;
      return cur + Math.sign(d) * maxDelta;
    },
    round: function (v) { return Math.round(v); },
    // 把世界方向转成 8 方向索引（0=S 面向相机，顺时针）
    dir8: function (dx, dz) {
      // 屏幕空间：+x 向右，+z 向下（朝向相机）
      var a = Math.atan2(dx, dz); // 0 => +z => 南
      var idx = Math.round(a / (Math.PI / 4));
      return ((idx % 8) + 8) % 8;
    }
  };

  // ---------- 随机 ----------
  // mulberry32：确定性 RNG，用于程序化美术（同种子同图）
  G.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  var _rng = Math.random;
  G.setRng = function (fn) { _rng = fn; };
  G.rand = function () { return _rng(); };
  G.randRange = function (a, b) { return a + _rng() * (b - a); };
  G.randInt = function (a, b) { return Math.floor(a + _rng() * (b - a + 1)); };
  G.chance = function (p) { return _rng() < p; };
  G.pick = function (arr) { return arr[Math.floor(_rng() * arr.length)]; };
  G.shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(_rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  // 加权抽样：entries = [{weight,...}]
  G.weighted = function (entries) {
    var total = 0, i;
    for (i = 0; i < entries.length; i++) total += (entries[i].weight || 1);
    if (total <= 0) return null;
    var r = _rng() * total;
    for (i = 0; i < entries.length; i++) {
      r -= (entries[i].weight || 1);
      if (r <= 0) return entries[i];
    }
    return entries[entries.length - 1];
  };

  // ---------- 事件总线 ----------
  G.bus = (function () {
    var map = {};
    return {
      on: function (evt, fn) { (map[evt] || (map[evt] = [])).push(fn); return fn; },
      off: function (evt, fn) {
        var l = map[evt]; if (!l) return;
        var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
      },
      emit: function (evt, payload) {
        var l = map[evt]; if (!l) return;
        for (var i = 0; i < l.length; i++) {
          try { l[i](payload); } catch (e) { console.error('[bus]', evt, e); }
        }
      },
      clear: function () { map = {}; }
    };
  })();

  // ---------- 文本 ----------
  G.fmt = {
    num: function (v) {
      if (v >= 10000) return (v / 1000).toFixed(1) + 'k';
      return String(Math.round(v));
    },
    time: function (sec) {
      var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    },
    // 游戏内时钟 0..1 -> HH:MM
    clock: function (t) {
      var total = t * 24 * 60;
      var h = Math.floor(total / 60), m = Math.floor(total % 60);
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }
  };

  // ---------- DOM 小工具 ----------
  G.dom = {
    el: function (tag, cls, parent, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      if (parent) parent.appendChild(e);
      return e;
    },
    clear: function (node) { while (node.firstChild) node.removeChild(node.firstChild); },
    show: function (node, on) { if (node) node.style.display = on ? '' : 'none'; }
  };

  // ---------- 时间的日志（开发用） ----------
  G.log = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[結]');
    console.log.apply(console, args);
  };

  // ---------- 简易对象池 ----------
  G.Pool = function (factory, reset) {
    this.factory = factory; this.reset = reset; this.free = [];
  };
  G.Pool.prototype.get = function () {
    return this.free.length ? this.free.pop() : this.factory();
  };
  G.Pool.prototype.put = function (o) {
    if (this.reset) this.reset(o);
    this.free.push(o);
  };

  // ---------- 配色板（全局共用，改色只改这里） ----------
  G.PALETTE = {
    // 高明度粉彩：Moonlighter 那种干净大色块
    sakura:   '#F7C8D8',
    cream:    '#FBF3E4',
    creamDim: '#E4D6BE',
    sky:      '#B8DCE8',
    skyDeep:  '#8FC4D8',
    moss:     '#9CB87A',
    mossDark: '#6E8C52',
    grass:    '#A8C583',
    grassDim: '#8AA96A',
    earth:    '#C9A87C',
    earthDark:'#9C7C55',
    wood:     '#B08060',
    woodDark: '#7A5540',
    vermilion:'#D9483B',   // 鸟居 / 纸灯
    vermilionD:'#A8302A',
    stone:    '#C8C3B8',
    stoneDark:'#9A968C',
    water:    '#9ED2DE',
    inkBrown: '#3A2E2A',   // 描边色（不用纯黑，太硬）
    inkSoft:  '#5B4A44',
    night:    '#2A3350',
    nightSky: '#1C2340',
    lampGlow: '#FFE9A8',
    hpRed:    '#E05A4F',
    hpGreen:  '#7FB069',
    gold:     '#E8C25A',
    expBlue:  '#7FB8D8',
    // 品质色：粗物/常品/良品/名品/灵宝
    quality: ['#9A968C', '#D8D2C4', '#7FB069', '#7FB8D8', '#D9A0E8'],
    qualityName: ['粗物', '常品', '良品', '名品', '灵宝']
  };

  // ---------- 颜色工具 ----------
  G.col = {
    hexToRgb: function (hex) {
      var h = hex.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    },
    rgbToHex: function (r, g, b) {
      var f = function (v) { v = Math.round(M.clamp(v, 0, 255)); return (v < 16 ? '0' : '') + v.toString(16); };
      return '#' + f(r) + f(g) + f(b);
    },
    mix: function (a, b, t) {
      var A = G.col.hexToRgb(a), B = G.col.hexToRgb(b);
      return G.col.rgbToHex(M.lerp(A.r, B.r, t), M.lerp(A.g, B.g, t), M.lerp(A.b, B.b, t));
    },
    shade: function (hex, amt) {
      // amt<0 变暗，>0 变亮
      var c = G.col.hexToRgb(hex);
      if (amt < 0) return G.col.rgbToHex(c.r * (1 + amt), c.g * (1 + amt), c.b * (1 + amt));
      return G.col.rgbToHex(M.lerp(c.r, 255, amt), M.lerp(c.g, 255, amt), M.lerp(c.b, 255, amt));
    }
  };

})(window.G = window.G || {});
