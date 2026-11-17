/* 16-assets.js — 外部素材包加载器
 *
 * 【为什么要有这个文件】
 * 用户要求：「改成可以下载美术包图片包的形式，加一个 loading 页面，
 * 加载对应的材质，用网上有的比较成熟的这类素材包」。
 *
 * 这推翻了本项目原先两条硬约束：
 *   1) 零外部资源（所有贴图程序化生成）
 *   2) 单文件交付（双击 game.html 即玩）
 *
 * 【关于 file:// 的硬限制（已实测）】
 *   - <img src="相对路径.png">           ✅ 能加载、能显示
 *   - canvas.getImageData()              ❌ tainted by cross-origin data
 *   - THREE.TextureLoader 在 file://     ❌ 加载失败（[object Event]）
 *
 * 所以素材包**必须通过 HTTP 打开**。用户已确认接受这一点。
 * 双击 game.html 会走降级路径（程序化贴图），并在 loading 页说明原因。
 *
 * 【加载策略】
 *   1) 读 assets/pack/manifest.json 拿到文件清单
 *   2) 用 XMLHttpRequest 或 fetch 拿 JSON（HTTP 下没问题）
 *   3) 逐张 THREE.TextureLoader 加载，回报进度
 *   4) 全部完成后 resolve
 */
(function (G) {
  'use strict';

  var A = G.assets = {};

  A.PACK_ROOT = 'assets/pack/';
  A.manifest = null;
  A.textures = {};        // id -> THREE.Texture
  A.charSheets = {};      // id -> { tex, frameW, frameH }
  A.loaded = false;
  A.failed = false;
  A.error = null;
  A.available = false;    // 素材包是否可用（HTTP 环境下为 true）

  // 进度回调（给 loading 页用）
  A.onProgress = null;

  /** 是否运行在能用外部资源的协议下 */
  A.canLoadExternal = function () {
    var p = window.location.protocol;
    return p === 'http:' || p === 'https:';
  };

  /**
   * 加载素材包。
   * @returns {Promise<void>}
   */
  A.load = function () {
    return new Promise(function (resolve) {
      if (!A.canLoadExternal()) {
        // file:// 下无法用 TextureLoader
        A.available = false;
        A.failed = false;
        A.error = 'file:// 下浏览器不允许加载外部贴图';
        console.warn('[assets] ' + A.error + '，将使用程序化贴图');
        _report(1, 1, 'file:// 模式：跳过外部素材');
        resolve();
        return;
      }

      A._fetchJSON(A.PACK_ROOT + 'manifest.json')
        .then(function (manifest) {
          A.manifest = manifest;
          A.available = true;
          return A._loadAll(manifest);
        })
        .then(function () {
          A.loaded = true;
          resolve();
        })
        .catch(function (err) {
          A.failed = true;
          A.error = String(err && err.message ? err.message : err);
          console.warn('[assets] 加载失败:', A.error);
          // 失败不阻塞游戏：降级到程序化贴图
          resolve();
        });
    });
  };

  // ---------- 内部 ----------

  function _report(done, total, label) {
    if (typeof A.onProgress === 'function') {
      A.onProgress(done, total, label || '');
    }
  }

  A._fetchJSON = function (url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('manifest.json 解析失败')); }
        } else {
          reject(new Error('manifest.json HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { reject(new Error('manifest.json 读取失败')); };
      xhr.send();
    });
  };

  A._loadAll = function (manifest) {
    var jobs = [];

    (manifest.files.chars || []).forEach(function (entry) {
      jobs.push({ kind: 'char', id: entry.id, path: entry.path });
    });
    (manifest.files.tiles || []).forEach(function (entry) {
      jobs.push({ kind: 'tile', id: entry.id, path: entry.path });
    });

    var total = jobs.length;
    var done = 0;
    _report(0, total, '准备加载素材');

    return Promise.all(jobs.map(function (job) {
      return A._loadTexture(A.PACK_ROOT + job.path)
        .then(function (tex) {
          if (job.kind === 'char') {
            A.charSheets[job.id] = {
              tex: tex,
              frameW: manifest.character.frameWidth,
              frameH: manifest.character.frameHeight,
              framesPerSet: manifest.character.framesPerSet,
              sets: manifest.character.sets
            };
          } else {
            A.textures[job.id] = tex;
          }
          done++;
          _report(done, total, job.id);
        });
    })).then(function () {
      _report(total, total, '完成');
    });
  };

  A._loadTexture = function (url) {
    return new Promise(function (resolve, reject) {
      var loader = new THREE.TextureLoader();
      loader.load(
        url,
        function (tex) {
          // 像素风必须最近邻采样，否则会糊成一团
          tex.minFilter = THREE.NearestFilter;
          tex.magFilter = THREE.NearestFilter;
          tex.generateMipmaps = false;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        },
        undefined,
        function () {
          reject(new Error('贴图加载失败: ' + url));
        }
      );
    });
  };

  /** 取角色图集 */
  A.getChar = function (id) {
    return A.charSheets[id] || null;
  };

  /** 取瓦片贴图 */
  A.getTile = function (id) {
    return A.textures[id] || null;
  };

  /** 有没有任何可用素材 */
  A.hasPack = function () {
    return A.loaded && A.available;
  };

})(window.G = window.G || {});
