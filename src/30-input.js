/* 30-input.js — 键鼠输入
 * 等距视角：WASD 屏幕相对移动；鼠标左键普攻/指向；右键闪避；1-4 技能
 */
(function (G) {
  'use strict';

  var I = G.input = {
    keys: {},          // 物理按键 -> bool
    pressed: {},       // 本帧刚按下
    released: {},
    mouse: { x: 0, y: 0, worldX: 0, worldZ: 0, down: false, clicked: false, rightClicked: false },
    wheel: 0,
    enabled: true
  };

  var KEYMAP = {
    'KeyW': 'up', 'ArrowUp': 'up',
    'KeyS': 'down', 'ArrowDown': 'down',
    'KeyA': 'left', 'ArrowLeft': 'left',
    'KeyD': 'right', 'ArrowRight': 'right',
    'KeyJ': 'attack', 'Space': 'attack',
    'KeyK': 'dodge', 'ShiftLeft': 'dodge',
    'Digit1': 'skill1', 'Digit2': 'skill2',
    'Digit3': 'skill3', 'Digit4': 'skill4',
    'KeyE': 'interact', 'KeyF': 'interact',
    'KeyQ': 'rotateL', 'KeyR': 'rotateR',
    'KeyI': 'inventory', 'KeyM': 'map', 'KeyC': 'character',
    // L = Log（手账/任务日志）。J 已被攻击占用，所以用 L。
    'KeyL': 'questlog',
    'Escape': 'escape', 'Tab': 'tab', 'KeyP': 'pause',
    'Enter': 'confirm'
  };

  var mouseDownButtons = {};

  I.init = function (canvas) {
    window.addEventListener('keydown', function (e) {
      if (!I.enabled) return;
      // 别拦截 F5/F12 等浏览器键
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var act = KEYMAP[e.code];
      if (act) {
        e.preventDefault();
        if (!I.keys[act]) I.pressed[act] = true;
        I.keys[act] = true;
      }
      // 防止空格滚动
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    }, { passive: false });

    window.addEventListener('keyup', function (e) {
      var act = KEYMAP[e.code];
      if (act) {
        I.keys[act] = false;
        I.released[act] = true;
      }
    });

    // 失焦时清空按键，避免"卡住一直往前走"
    window.addEventListener('blur', function () {
      I.keys = {}; I.pressed = {};
      mouseDownButtons = {};
      I.mouse.down = false;
    });

    // 鼠标事件绑在 window 上而不是 canvas 上：
    // #ui 是全屏覆盖层（pointer-events:none 只对"没有 auto 的子元素"生效），
    // 绑 canvas 的话点击会被 UI 层吃掉 —— 踩过：点击画面完全不打怪。
    window.addEventListener('mousemove', function (e) {
      I.mouse.x = e.clientX;
      I.mouse.y = e.clientY;
    });

    window.addEventListener('mousedown', function (e) {
      if (!I.enabled) return;
      // 点到会拦截指针的 UI（面板/对话框按钮）时，不当作游戏输入
      if (isUiTarget(e.target)) return;
      mouseDownButtons[e.button] = true;
      if (e.button === 0) { I.mouse.down = true; I.mouse.clicked = true; }
      if (e.button === 2) { I.mouse.rightClicked = true; }
      e.preventDefault();
    });

    window.addEventListener('mouseup', function (e) {
      mouseDownButtons[e.button] = false;
      if (e.button === 0) I.mouse.down = false;
    });

    window.addEventListener('contextmenu', function (e) {
      if (isUiTarget(e.target)) return;
      e.preventDefault();
    });

    window.addEventListener('wheel', function (e) {
      if (!I.enabled) return;
      if (isUiTarget(e.target)) return;
      I.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  };

  /** 判断事件目标是否是"要吃指针的 UI" */
  function isUiTarget(el) {
    if (!el || !el.closest) return false;
    // 这些容器里的东西是玩家要点的，不能当游戏输入
    return !!el.closest('.overlay, .dialog, .dlg-choice, .sr-buy, .bagitem, .dlg-choices');
  }

  /** 每帧末尾调用，清空"刚按下"状态 */
  I.endFrame = function () {
    I.pressed = {};
    I.released = {};
    I.mouse.clicked = false;
    I.mouse.rightClicked = false;
    I.wheel = 0;
  };

  I.axis = function () {
    var x = 0, y = 0;
    if (I.keys.left) x -= 1;
    if (I.keys.right) x += 1;
    if (I.keys.up) y -= 1;
    if (I.keys.down) y += 1;
    // 归一化对角线
    if (x !== 0 && y !== 0) {
      var inv = Math.SQRT1_2;
      x *= inv; y *= inv;
    }
    return { x: x, y: y };
  };

  I.anyMove = function () {
    return !!(I.keys.left || I.keys.right || I.keys.up || I.keys.down);
  };

  // 触摸设备兜底：虚拟摇杆由 UI 提供，这里只暴露接口
  I.setVirtualAxis = function (x, y) {
    I._vt = { x: x, y: y };
    if (x < -0.3) I.keys.left = true; else I.keys.left = false;
    if (x > 0.3) I.keys.right = true; else I.keys.right = false;
    if (y < -0.3) I.keys.up = true; else I.keys.up = false;
    if (y > 0.3) I.keys.down = true; else I.keys.down = false;
  };

})(window.G = window.G || {});
