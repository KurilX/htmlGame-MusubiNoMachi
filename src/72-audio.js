/* 72-audio.js — WebAudio 程序化音频（零音频文件）
 *
 * BGM：都节音阶（D 都节：D Eb G A Bb）的五声循环 + 简单低音
 * SFX：合成波形（噪声/正弦/方波）+ 包络
 */
(function (G) {
  'use strict';

  var A = G.audio = {};

  A.ctx = null;
  A.master = null;
  A.enabled = true;
  A.bgmOn = true;
  A.bgmTimer = 0;
  A.bgmStep = 0;
  A.bgmPattern = [0, 2, 4, 5, 7, 5, 4, 2];  // 音级索引
  A.bgmRoot = 293.66;                        // D4
  A.bgmInterval = 0.62;

  // 都节音阶（半音偏移）：0, 1, 5, 7, 8
  var MIYAKO = [0, 1, 5, 7, 8, 12, 13, 17];

  A.init = function () {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { A.enabled = false; return; }
      A.ctx = new Ctx();
      A.master = A.ctx.createGain();
      A.master.gain.value = 0.32;
      A.master.connect(A.ctx.destination);

      // 用户第一次交互后恢复（浏览器策略）
      var resume = function () {
        if (A.ctx.state === 'suspended') A.ctx.resume();
        window.removeEventListener('pointerdown', resume);
        window.removeEventListener('keydown', resume);
      };
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);

      A.startBGM();
    } catch (e) {
      console.warn('[audio] init failed', e);
      A.enabled = false;
    }
  };

  // =====================================================================
  // 基础合成
  // =====================================================================
  function env(gain, t0, attack, decay, peak, sustain) {
    var g = gain.gain;
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t0 + attack + decay);
  }

  function tone(freq, dur, type, peak, opt) {
    if (!A.ctx || !A.enabled) return;
    opt = opt || {};
    var t0 = A.ctx.currentTime;
    var osc = A.ctx.createOscillator();
    var gain = A.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opt.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(opt.slideTo, t0 + dur);
    }
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak != null ? peak : 0.2, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(opt.dest || A.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, peak, opt) {
    if (!A.ctx || !A.enabled) return;
    opt = opt || {};
    var t0 = A.ctx.currentTime;
    var len = Math.max(1, Math.floor(A.ctx.sampleRate * dur));
    var buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = A.ctx.createBufferSource();
    src.buffer = buf;

    var filter = A.ctx.createBiquadFilter();
    filter.type = opt.filterType || 'bandpass';
    filter.frequency.setValueAtTime(opt.freq || 1200, t0);
    if (opt.freqTo) filter.frequency.exponentialRampToValueAtTime(opt.freqTo, t0 + dur);
    filter.Q.value = opt.q != null ? opt.q : 1.2;

    var gain = A.ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak != null ? peak : 0.25, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(A.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // =====================================================================
  // 音效表
  // =====================================================================
  A.play = function (id) {
    if (!A.enabled || !A.ctx) return;
    switch (id) {
      case 'slash':
        noise(0.13, 0.24, { freq: 2600, freqTo: 900, q: 0.9 });
        break;
      case 'hit':
        noise(0.09, 0.3, { freq: 900, freqTo: 220, q: 1.4 });
        tone(150, 0.09, 'square', 0.1, { slideTo: 70 });
        break;
      case 'hit_crit':
        noise(0.14, 0.34, { freq: 1600, freqTo: 300, q: 1.1 });
        tone(320, 0.12, 'square', 0.14, { slideTo: 110 });
        break;
      case 'dodge':
        noise(0.18, 0.16, { freq: 700, freqTo: 2200, q: 2.2 });
        break;
      case 'skill1':
        tone(520, 0.26, 'triangle', 0.2, { slideTo: 980 });
        noise(0.2, 0.18, { freq: 2800, freqTo: 700, q: 1.4 });
        break;
      case 'skill2':
        tone(220, 0.3, 'sawtooth', 0.13, { slideTo: 440 });
        noise(0.26, 0.2, { freq: 1400, freqTo: 500, q: 1.0 });
        break;
      case 'skill3':
        tone(880, 0.2, 'triangle', 0.16, { slideTo: 1600 });
        noise(0.14, 0.14, { freq: 3200, freqTo: 1400, q: 2 });
        break;
      case 'skill4':
        tone(330, 0.4, 'sine', 0.16);
        tone(495, 0.4, 'sine', 0.1);
        break;
      case 'parry_hit':
        tone(1200, 0.16, 'square', 0.22, { slideTo: 400 });
        noise(0.1, 0.3, { freq: 4000, freqTo: 1200, q: 2 });
        break;
      case 'player_hurt':
        tone(180, 0.2, 'sawtooth', 0.18, { slideTo: 90 });
        noise(0.16, 0.2, { freq: 500, freqTo: 180, q: 1 });
        break;
      case 'enemy_die':
        tone(300, 0.3, 'triangle', 0.12, { slideTo: 90 });
        noise(0.25, 0.14, { freq: 900, freqTo: 200, q: 0.8 });
        break;
      case 'enemy_cast':
        tone(400, 0.16, 'sine', 0.09, { slideTo: 200 });
        break;
      case 'levelup':
        [0, 4, 7, 12].forEach(function (semi, i) {
          setTimeout(function () {
            tone(523.25 * Math.pow(2, semi / 12), 0.26, 'triangle', 0.16);
          }, i * 90);
        });
        break;
      case 'pickup':
        tone(880, 0.1, 'sine', 0.13, { slideTo: 1320 });
        break;
      case 'pickup_rare':
        [0, 7, 12].forEach(function (semi, i) {
          setTimeout(function () {
            tone(659.25 * Math.pow(2, semi / 12), 0.3, 'triangle', 0.16);
          }, i * 70);
        });
        break;
      case 'chest':
        tone(440, 0.16, 'sine', 0.13);
        setTimeout(function () { tone(660, 0.24, 'sine', 0.13); }, 110);
        break;
      case 'heal':
        tone(660, 0.14, 'sine', 0.11, { slideTo: 990 });
        break;
      case 'gather':
        noise(0.14, 0.14, { freq: 1800, freqTo: 600, q: 1.4 });
        break;
      case 'equip':
        tone(520, 0.1, 'square', 0.08);
        break;
      case 'buy':
        tone(760, 0.1, 'sine', 0.1);
        setTimeout(function () { tone(1020, 0.14, 'sine', 0.08); }, 70);
        break;
      case 'reforge':
        [0, 3, 7].forEach(function (s, i) {
          setTimeout(function () { tone(520 * Math.pow(2, s / 12), 0.3, 'triangle', 0.12); }, i * 80);
        });
        break;
      case 'knot':
        [0, 5, 12].forEach(function (s, i) {
          setTimeout(function () { tone(392 * Math.pow(2, s / 12), 0.5, 'sine', 0.14); }, i * 140);
        });
        break;
      case 'skill_unlock':
        [0, 4, 7, 12, 16].forEach(function (s, i) {
          setTimeout(function () { tone(523.25 * Math.pow(2, s / 12), 0.4, 'triangle', 0.13); }, i * 100);
        });
        break;
      case 'boss_slam':
        tone(80, 0.5, 'sine', 0.28, { slideTo: 40 });
        noise(0.4, 0.24, { freq: 300, freqTo: 80, q: 0.7 });
        break;
      case 'ui':
        tone(720, 0.06, 'sine', 0.06);
        break;
    }
  };

  // =====================================================================
  // BGM：都节音阶的缓慢循环
  // =====================================================================
  A.startBGM = function () {
    if (!A.ctx) return;
    A.bgmNext = A.ctx.currentTime + 0.5;
  };

  A.update = function (dt) {
    if (!A.enabled || !A.ctx || !A.bgmOn) return;
    var now = A.ctx.currentTime;
    if (!A.bgmNext) return;

    // 提前调度
    while (A.bgmNext < now + 0.25) {
      A.scheduleBgmNote(A.bgmNext);
      A.bgmNext += A.bgmInterval;
      A.bgmStep++;
    }
  };

  A.scheduleBgmNote = function (t) {
    if (!A.ctx) return;
    var step = A.bgmStep % 16;
    var idx = A.bgmPattern[step % A.bgmPattern.length];
    var semi = MIYAKO[idx % MIYAKO.length];
    var freq = A.bgmRoot * Math.pow(2, semi / 12);

    // 主旋律
    if (step % 2 === 0) A.noteAt(freq, t, 0.85, 'triangle', 0.055);
    // 低八度
    if (step % 4 === 0) A.noteAt(freq / 2, t, 1.4, 'sine', 0.05);
    // 偶尔高音点缀
    if (step === 10) A.noteAt(freq * 2, t, 0.5, 'sine', 0.028);
  };

  A.noteAt = function (freq, t, dur, type, peak) {
    var osc = A.ctx.createOscillator();
    var gain = A.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(A.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };

  A.toggleBGM = function () {
    A.bgmOn = !A.bgmOn;
    return A.bgmOn;
  };

})(window.G = window.G || {});
