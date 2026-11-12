/* data/regions-content.js — 新地区的物件与刷怪配置
 *
 * 三个新地区：
 *   神山（北，z 70~210）      : 山道石阶、山石、鸟居、山顶神社、云雾
 *   码头小镇（东南，x 90~150） : 栈桥、船、木箱、木桶、旗帜、渔网、渔屋
 *   沙滩（东，x 90~180）      : 礁石、海草、贝壳、海、沙滩
 *
 * 用程序化生成 + 手工关键点结合：关键地标手写，装饰物用确定性 RNG 撒。
 */
(function (G) {
  'use strict';

  G.DATA = G.DATA || {};

  // =====================================================================
  // 手工摆放的关键地标
  // =====================================================================
  G.DATA.REGION_PROPS = [
    // ---------- 神山 ----------
    // 登山道：从平野北端（z≈75）一路往上到峰顶（z=140）
    { type: 'mountainStairs', x: 0, z: 82, steps: 8, w: 3.4, rise: 0.22, run: 0.6, rotY: 0 },
    { type: 'mountainStairs', x: 0, z: 92, steps: 10, w: 3.2, rise: 0.24, run: 0.58, rotY: 0 },
    { type: 'mountainStairs', x: 0, z: 103, steps: 10, w: 3.0, rise: 0.26, run: 0.56, rotY: 0 },
    { type: 'mountainStairs', x: 0, z: 114, steps: 12, w: 2.8, rise: 0.28, run: 0.54, rotY: 0 },
    { type: 'mountainStairs', x: 0, z: 126, steps: 12, w: 2.6, rise: 0.3, run: 0.52, rotY: 0 },

    // 山门鸟居（登山起点）
    { type: 'torii', x: 0, z: 78, w: 8, h: 8, rotY: 0 },
    // 半山的第二个鸟居
    { type: 'torii', x: 0, z: 118, w: 6, h: 6.5, rotY: 0 },

    // 山顶神社 + 大鸟居（地标）
    { type: 'torii', x: 0, z: 136, w: 10, h: 9.5, rotY: 0, color: '#C8483C' },
    { type: 'shrine', x: 0, z: 142, rotY: 0 },
    { type: 'pagoda', x: -16, z: 146, tiers: 3, baseW: 3.6,
      color: '#DDBE96', roof: '#D49280' },

    // 山道两侧的石灯笼
    { type: 'stoneLantern', x: -3.2, z: 84, scale: 1.3 },
    { type: 'stoneLantern', x: 3.2, z: 84, scale: 1.3 },
    { type: 'stoneLantern', x: -3.0, z: 96, scale: 1.3 },
    { type: 'stoneLantern', x: 3.0, z: 96, scale: 1.3 },
    { type: 'stoneLantern', x: -2.8, z: 108, scale: 1.35 },
    { type: 'stoneLantern', x: 2.8, z: 108, scale: 1.35 },
    { type: 'stoneLantern', x: -2.6, z: 120, scale: 1.35 },
    { type: 'stoneLantern', x: 2.6, z: 120, scale: 1.35 },
    { type: 'stoneLantern', x: -4.5, z: 138, scale: 1.5 },
    { type: 'stoneLantern', x: 4.5, z: 138, scale: 1.5 },

    // 山腰云雾
    { type: 'mist', x: -20, z: 115, count: 6, spread: 14, scale: 1.6, opacity: 0.22 },
    { type: 'mist', x: 22, z: 125, count: 5, spread: 12, scale: 1.4, opacity: 0.2 },
    { type: 'mist', x: 0, z: 155, count: 7, spread: 20, scale: 2.0, opacity: 0.18 },

    // 神山副本入口（山顶后方）
    { type: 'gate', x: 0, z: 158, uid: 'gate_mountain', region: 'mountain' },

    // 神山碑文
    { type: 'stele', x: 8, z: 90, uid: 'stele_mount_1' },
    { type: 'stele', x: -9, z: 131, uid: 'stele_mount_2' },

    // ---------- 码头小镇 ----------
    // 海面：只覆盖东侧海域。
    //
    // 【踩过的坑】原来写 x=175, w=200，海面的左边缘到了 x=75，
    // 把整个神山都淹了（截图里山腰出现一片海水）。
    // 正确做法：海面中心放在海岸线以东，宽度只够覆盖到视野外即可。
    // 海岸线约在 x=118，所以中心 210、宽 190 -> 左边缘 115，正好接岸。
    { type: 'sea', x: 210, z: 100, w: 190, d: 300 },

    // 主栈桥（伸向海里）
    { type: 'pier', x: 128, z: 66, len: 16, w: 3.4, deckY: 1.5, rotY: Math.PI / 2 },
    // 副栈桥
    { type: 'pier', x: 136, z: 84, len: 11, w: 2.8, deckY: 1.4, rotY: Math.PI / 2 },

    // 船（停靠在栈桥旁）
    { type: 'boat', x: 136, z: 62, len: 4.6, w: 1.6, rotY: Math.PI / 2 },
    { type: 'boat', x: 142, z: 76, len: 4.0, w: 1.4, rotY: Math.PI / 2 + 0.2 },
    { type: 'boat', x: 122, z: 88, len: 3.6, w: 1.3, rotY: Math.PI / 2 - 0.15 },

    // 码头建筑（渔屋、仓库）
    { type: 'house', x: 112, z: 54, w: 6.5, d: 5.5, h: 2.6, rotY: 0.1, noren: '#7FB8D8' },
    { type: 'house', x: 116, z: 80, w: 5.5, d: 5, h: 2.4, rotY: -0.15, noren: '#D9483B' },
    { type: 'house', x: 104, z: 68, w: 7, d: 5.5, h: 2.8, rotY: 0.05, noren: '#9CB87A' },

    // 旗帜（码头入口）
    { type: 'banner', x: 100, z: 58, h: 3.4, color: '#D9483B' },
    { type: 'banner', x: 124, z: 90, h: 3.2, color: '#7FB8D8' },
    { type: 'banner', x: 108, z: 76, h: 3.0, color: '#E8C25A' },

    // 渔网
    { type: 'fishingNet', x: 118, z: 60, w: 3.2, h: 1.7 },
    { type: 'fishingNet', x: 126, z: 82, w: 2.8, h: 1.5 },

    // 木箱木桶（散落在码头）
    { type: 'crate', x: 114, z: 62, size: 0.7, seed: 701 },
    { type: 'crate', x: 115.5, z: 63.2, size: 0.6, seed: 702 },
    { type: 'crate', x: 120, z: 72, size: 0.75, seed: 703 },
    { type: 'barrel', x: 112, z: 64, r: 0.36, h: 0.85, seed: 711 },
    { type: 'barrel', x: 113.2, z: 65.4, r: 0.34, h: 0.8, seed: 712 },
    { type: 'barrel', x: 122, z: 70, r: 0.38, h: 0.9, seed: 713 },
    { type: 'crate', x: 106, z: 74, size: 0.65, seed: 704 },

    // 码头樱花与灯笼
    { type: 'sakura', x: 106, z: 48, scale: 1.1, seed: 901 },
    { type: 'sakura', x: 122, z: 46, scale: 1.0, seed: 902 },
    { type: 'lantern', x: 110, z: 58, poleH: 3.0 },
    { type: 'lantern', x: 118, z: 86, poleH: 2.8 },

    // 码头碑文
    { type: 'stele', x: 102, z: 64, uid: 'stele_harbor_1' },

    // ---------- 沙滩 ----------
    // 沙滩沙地（覆盖 x 90~180, z 100~190）
    { type: 'beachSand', x: 135, z: 145, w: 90, d: 110 },

    // 礁石群
    { type: 'reef', x: 158, z: 118, seed: 501 },
    { type: 'reef', x: 166, z: 136, seed: 502 },
    { type: 'reef', x: 152, z: 156, seed: 503 },
    { type: 'reef', x: 170, z: 165, seed: 504 },
    { type: 'reef', x: 146, z: 175, seed: 505 },
    { type: 'reef', x: 162, z: 188, seed: 506 },

    // 沙滩上的岩石与海草
    { type: 'rock', x: 112, z: 118, size: 0.9, seed: 311 },
    { type: 'rock', x: 128, z: 160, size: 1.1, seed: 312 },
    { type: 'rock', x: 140, z: 130, size: 0.8, seed: 313 },
    { type: 'bush', x: 105, z: 142, seed: 411 },
    { type: 'bush', x: 118, z: 168, seed: 412 },

    // 沙滩通往码头的路
    { type: 'path', x: 118, z: 96, w: 3.6, d: 14, y: 0.012 },
    { type: 'path', x: 122, z: 110, w: 3.4, d: 14, y: 0.012 },
    { type: 'path', x: 126, z: 124, w: 3.2, d: 14, y: 0.012 },

    // 沙滩副本入口（沙滩南端）
    { type: 'gate', x: 150, z: 178, uid: 'gate_beach', region: 'beach' },

    // 沙滩碑文与宝箱
    { type: 'stele', x: 122, z: 155, uid: 'stele_beach_1' },
    { type: 'chest', x: 160, z: 150, uid: 'chest_beach_1', loot: 'rare' },
    { type: 'chest', x: 144, z: 185, uid: 'chest_beach_2', loot: 'common' },
    { type: 'chest', x: 172, z: 160, uid: 'chest_beach_3', loot: 'rare' }
  ];

  // =====================================================================
  // 程序化撒物：装饰物（岩石/草丛）用确定性 RNG 批量生成
  // =====================================================================
  G.DATA.generateRegionDecor = function () {
    var out = [];
    var rnd = G.mulberry32(20260101);

    // 神山：山石散布（山腰两侧）
    for (var i = 0; i < 26; i++) {
      var mx = (rnd() - 0.5) * 100;
      var mz = 80 + rnd() * 130;
      // 避开山道（x 绝对值 < 12 的地方不放，留出通路）
      if (Math.abs(mx) < 12) continue;
      out.push({
        type: 'mountainRock', x: +mx.toFixed(1), z: +mz.toFixed(1),
        size: 1.4 + rnd() * 1.6, seed: 1000 + i
      });
    }

    // 神山：松树（用樱花树改色模拟，实际是深绿针叶）
    for (var j = 0; j < 18; j++) {
      var tx = (rnd() - 0.5) * 110;
      var tz = 82 + rnd() * 125;
      if (Math.abs(tx) < 10) continue;
      out.push({
        type: 'sakura', x: +tx.toFixed(1), z: +tz.toFixed(1),
        scale: 0.85 + rnd() * 0.5, seed: 2000 + j,
        // 用深绿花色模拟松树
        overrideColor: true
      });
    }

    // 沙滩：贝壳（小装饰，用 bush 的小尺寸代替）
    for (var k = 0; k < 30; k++) {
      var bx = 100 + rnd() * 70;
      var bz = 115 + rnd() * 70;
      out.push({
        type: 'bush', x: +bx.toFixed(1), z: +bz.toFixed(1),
        seed: 3000 + k
      });
    }

    // 码头：路边草丛
    for (var m = 0; m < 16; m++) {
      var hx = 96 + rnd() * 46;
      var hz = 44 + rnd() * 50;
      out.push({
        type: 'bush', x: +hx.toFixed(1), z: +hz.toFixed(1),
        seed: 4000 + m
      });
    }

    return out;
  };

  // =====================================================================
  // 新地区的刷怪区
  // =====================================================================
  G.DATA.REGION_SPAWN_ZONES = [
    {
      id: 'mount_low', name: '神山・参道',
      minX: -22, maxX: 22, minZ: 80, maxZ: 112,
      day: [{ id: 'kappa', count: 3 }, { id: 'tengu', count: 2 }],
      night: [{ id: 'yurei', count: 3 }, { id: 'onibi', count: 2 }],
      respawnSec: 28
    },
    {
      id: 'mount_high', name: '神山・山腰',
      minX: -28, maxX: 28, minZ: 112, maxZ: 150,
      day: [{ id: 'tengu', count: 4 }, { id: 'oni_small', count: 2 }],
      night: [{ id: 'tengu', count: 3 }, { id: 'yurei', count: 3 }],
      respawnSec: 32
    },
    {
      id: 'harbor_town', name: '湊町・桟橋',
      minX: 96, maxX: 148, minZ: 42, maxZ: 96,
      // 码头是半安全区：只有少量怪（人形怪，未来可换）
      day: [{ id: 'kappa', count: 2 }],
      night: [{ id: 'onibi', count: 3 }],
      respawnSec: 36,
      safe: true            // 标记：低威胁
    },
    {
      id: 'beach_shore', name: '渚・海岸',
      minX: 100, maxX: 175, minZ: 100, maxZ: 175,
      day: [{ id: 'kappa', count: 4 }, { id: 'onibi', count: 2 }],
      night: [{ id: 'yurei', count: 4 }, { id: 'onibi', count: 3 }],
      respawnSec: 26
    }
  ];

})(window.G = window.G || {});
