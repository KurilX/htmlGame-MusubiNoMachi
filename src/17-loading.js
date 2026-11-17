/* 17-loading.js — 加载页
 *
 * 【职责】
 *  - 在素材包加载期间显示进度条与当前加载的文件
 *  - file:// 时给出明确提示（而不是黑屏让人以为坏了）
 *  - 加载完成后淡出
 *  - 提供"素材来源"面板（CC-BY 素材的法定署名要求）
 */
(function (G) {
  'use strict';

  var L = G.loading = {};

  var root = null;
  var bar = null;
  var barText = null;
  var stageText = null;
  var noteEl = null;

  L.build = function () {
    if (root) return;

    root = document.createElement('div');
    root.id = 'loadingScreen';
    root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:radial-gradient(ellipse at 50% 40%, #1A1620, #0A0810 70%)',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'font-family:"Noto Sans SC","Microsoft YaHei",sans-serif',
      'transition:opacity .5s ease'
    ].join(';');

    // 标题
    var title = document.createElement('div');
    title.textContent = '結ノ町';
    title.style.cssText = [
      'font-size:34px', 'letter-spacing:12px', 'text-indent:12px',
      'color:#F7C8D8', 'font-weight:300',
      'text-shadow:0 0 24px rgba(247,200,216,0.35)',
      'margin-bottom:6px'
    ].join(';');
    root.appendChild(title);

    var sub = document.createElement('div');
    sub.textContent = 'むすびのまち';
    sub.style.cssText = 'font-size:11px;letter-spacing:5px;text-indent:5px;color:rgba(232,224,216,0.4);margin-bottom:38px';
    root.appendChild(sub);

    // 进度条
    var track = document.createElement('div');
    track.id = 'loadingTrack';
    track.style.cssText = [
      'width:300px', 'height:3px',
      'background:rgba(247,200,216,0.15)',
      'border-radius:2px', 'overflow:hidden'
    ].join(';');
    root.appendChild(track);

    bar = document.createElement('div');
    bar.id = 'loadingBar';
    bar.style.cssText = [
      'width:0%', 'height:100%',
      'background:linear-gradient(90deg,#F7C8D8,#E8C25A)',
      'transition:width .2s ease'
    ].join(';');
    track.appendChild(bar);

    barText = document.createElement('div');
    barText.style.cssText = 'margin-top:10px;font-size:11px;color:rgba(232,224,216,0.5)';
    barText.textContent = '准备中…';
    root.appendChild(barText);

    stageText = document.createElement('div');
    stageText.style.cssText = 'margin-top:4px;font-size:10px;color:rgba(232,224,216,0.28);height:14px';
    root.appendChild(stageText);

    // 提示区（file:// 警告等）
    noteEl = document.createElement('div');
    noteEl.style.cssText = [
      'margin-top:30px', 'max-width:440px', 'padding:12px 16px',
      'font-size:11px', 'line-height:1.7',
      'color:#E8C25A', 'background:rgba(232,194,90,0.08)',
      'border-left:2px solid rgba(232,194,90,0.5)',
      'border-radius:3px', 'display:none',
      'text-align:left'
    ].join(';');
    root.appendChild(noteEl);

    document.body.appendChild(root);

    // 进度回调接到加载器
    if (G.assets) {
      G.assets.onProgress = function (done, total, label) {
        L.setProgress(done, total, label);
      };
    }
  };

  L.setProgress = function (done, total, label) {
    if (!bar) return;
    var pct = total > 0 ? (done / total) * 100 : 0;
    bar.style.width = pct.toFixed(1) + '%';
    barText.textContent = '加载素材 ' + done + ' / ' + total;
    if (label) stageText.textContent = label;
  };

  L.setMessage = function (msg, isNote) {
    if (!barText) return;
    if (isNote) {
      noteEl.style.display = '';
      noteEl.innerHTML = msg;
    } else {
      barText.textContent = msg;
    }
  };

  /** 显示 file:// 提示 */
  L.showFileProtocolNote = function () {
    if (!noteEl) return;
    noteEl.style.display = '';
    noteEl.innerHTML =
      '<b>当前是 file:// 打开</b><br>' +
      '浏览器不允许网页从本地文件系统加载外部图片贴图，' +
      '所以本次会使用<b>程序化生成的贴图</b>（旧版画风）。<br><br>' +
      '要看到素材包画风，请通过 HTTP 打开：<br>' +
      '<code style="color:#F7C8D8">npx serve .</code> 或 ' +
      '<code style="color:#F7C8D8">python -m http.server</code><br>' +
      '然后访问 http://localhost:8000/game.html';
  };

  /** 淡出并移除 */
  L.hide = function (cb) {
    if (!root) { if (cb) cb(); return; }
    root.style.opacity = '0';
    setTimeout(function () {
      if (root && root.parentNode) root.parentNode.removeChild(root);
      root = null;
      bar = null; barText = null; stageText = null; noteEl = null;
      if (cb) cb();
    }, 550);
  };

  // =====================================================================
  // 素材来源（CC-BY 的署名要求）
  // =====================================================================
  L.showCredits = function () {
    var m = G.assets && G.assets.manifest;
    var wrap = document.createElement('div');
    wrap.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99998',
      'background:rgba(10,8,16,0.94)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:"Noto Sans SC","Microsoft YaHei",sans-serif'
    ].join(';');

    var panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(560px,90vw)', 'max-height:80vh', 'overflow-y:auto',
      'background:rgba(24,20,26,0.98)',
      'border:1px solid rgba(247,200,216,0.2)',
      'border-radius:6px', 'padding:24px 28px',
      'font-size:12px', 'line-height:1.8', 'color:#E8E0D8'
    ].join(';');

    var h = document.createElement('div');
    h.textContent = '素材来源';
    h.style.cssText = 'font-size:16px;letter-spacing:3px;color:#F7C8D8;margin-bottom:16px';
    panel.appendChild(h);

    var list = (m && m.credits) ? m.credits : [];
    if (!list.length) {
      var p = document.createElement('div');
      p.textContent = '当前使用程序化生成的贴图（无外部素材）。';
      p.style.color = 'rgba(232,224,216,0.6)';
      panel.appendChild(p);
    } else {
      list.forEach(function (c) {
        var row = document.createElement('div');
        row.style.cssText = 'margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.07)';

        var t = document.createElement('div');
        t.textContent = c.title;
        t.style.cssText = 'color:#F3EBE4;margin-bottom:3px';
        row.appendChild(t);

        var a = document.createElement('div');
        a.style.cssText = 'font-size:11px;color:rgba(232,224,216,0.55)';
        a.textContent = '作者：' + c.author + '　授权：' + c.license;
        row.appendChild(a);

        if (c.url) {
          var link = document.createElement('a');
          link.href = c.url;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = c.url;
          link.style.cssText = 'font-size:10px;color:#7FB8C8;word-break:break-all';
          row.appendChild(link);
        }
        panel.appendChild(row);
      });
    }

    var close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText = [
      'margin-top:8px', 'padding:7px 18px',
      'background:rgba(255,255,255,0.05)',
      'border:1px solid rgba(255,255,255,0.18)',
      'border-radius:3px', 'color:#E8E0D8',
      'font-family:inherit', 'font-size:12px', 'cursor:pointer'
    ].join(';');
    close.onclick = function () { wrap.parentNode.removeChild(wrap); };
    panel.appendChild(close);

    wrap.appendChild(panel);
    wrap.onclick = function (e) { if (e.target === wrap) wrap.parentNode.removeChild(wrap); };
    document.body.appendChild(wrap);
  };

})(window.G = window.G || {});
