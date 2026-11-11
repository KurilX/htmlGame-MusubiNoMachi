// tools/make-probe.js — 生成带运行时探针的 dev 副本
// 关键：headless + --virtual-time-budget 下 rAF 几乎不触发，
// 所以这里用 setInterval 手动推进游戏逻辑来验证系统。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let s = fs.readFileSync(path.join(root, 'dev.html'), 'utf8');

const probe = `
<script>
(function () {
  var p = document.createElement('pre');
  p.id = 'probe';
  p.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:999;background:#000d;color:#0f0;padding:8px;font:11px/1.35 monospace;white-space:pre;border:1px solid #0f0;max-height:46vh;overflow:auto';
  document.body.appendChild(p);
  var L = [];
  function log(x) { L.push(x); }
  function flush() { p.textContent = L.join('\\n'); }

  // 手动推进：直接调 step 逻辑，绕过 rAF
  function manualTick(seconds) {
    var steps = Math.floor(seconds / (1/60));
    for (var i = 0; i < steps; i++) {
      try {
        // 复用主循环的 step：通过 G.main 暴露的入口
        if (G.tickOnce) G.tickOnce(1/60);
      } catch (e) {
        log('tick EX: ' + e.message);
        break;
      }
    }
  }

  var phase = 0;
  var iv = setInterval(function () {
    try {
      if (phase === 0) {
        log('boot: errs=' + (window.__ERRORS__ || []).length);
        log('canvas=' + G.pixels.renderer.domElement.style.width + ' scale=' + G.pixels.scale.toFixed(2));
        log('player=' + G.player.state.x.toFixed(1) + ',' + G.player.state.z.toFixed(1));
        log('npcs=' + G.world.npcs.length + ' props=' + G.world.props.length + ' inter=' + G.world.interactables.length);
        log('tickOnce available: ' + (typeof G.tickOnce));
        phase = 1;
      } else if (phase === 1) {
        manualTick(8);
        log('--- after 8s manual tick ---');
        log('enemies=' + G.enemy.list.length + ' elapsed=' + G.main.elapsed.toFixed(1));
        for (var i = 0; i < G.world.spawnZones.length; i++) {
          var z = G.world.spawnZones[i];
          log(' [' + z.data.id + '] alive=' + z.alive.length + ' timer=' + z.timer.toFixed(1));
        }
        phase = 2;
      } else if (phase === 2) {
        // 模拟战斗：把玩家传送到怪旁边，打一下
        if (G.enemy.list.length > 0) {
          var e = G.enemy.list[0];
          var beforeHp = e.hp;
          G.player.state.x = e.x + 1.2;
          G.player.state.z = e.z;
          var dmg = G.combat.cone({
            x: G.player.state.x, z: G.player.state.z,
            angle: Math.atan2(e.x - G.player.state.x, e.z - G.player.state.z),
            arc: Math.PI, radius: 3,
            damage: 25, crit: false, source: 'player',
            knockback: 3, hitstopMs: 60
          });
          log('--- combat test ---');
          log('enemy hp ' + beforeHp + ' -> ' + e.hp + ' (dealt ' + dmg + ')');
        } else {
          log('--- combat test SKIPPED (no enemies) ---');
        }
        phase = 3;
      } else if (phase === 3) {
        // 测试装备生成与重铸
        log('--- item test ---');
        var g = G.inv.rollGear('weapon', 3);
        log('rolled: ' + g.name + ' q' + g.quality + ' atk+' + g.baseAtk + ' affixes=' + (g.affixes||[]).length);
        G.inv.add(g, 1);
        log('bag=' + G.player.state.bag.length);
        G.player.state.gold = 500;
        var r = G.inv.reforge(g.uid);
        log('reforge: ' + (r.ok ? 'OK cost=' + r.cost + ' newAffixes=' + r.item.affixes.length : 'FAIL ' + r.msg));
        phase = 4;
      } else if (phase === 4) {
        log('--- save test ---');
        try {
          var ok = G.save.save(1);
          var loaded = G.save.load(1);
          log('save=' + ok + ' load=' + (loaded ? 'OK lv' + loaded.player.level + ' gold' + loaded.player.gold : 'NULL'));
        } catch (ex) { log('save EX: ' + ex.message); }
        log('final errs=' + (window.__ERRORS__ || []).length);
        if (window.__ERRORS__ && window.__ERRORS__.length) log(window.__ERRORS__.join('\\n'));
        flush();
        clearInterval(iv);
        document.title = 'PROBE-DONE';
        phase = 5;
      }
      flush();
    } catch (e) {
      log('PHASE EX: ' + e.message + ' | ' + (e.stack || '').split('\\n')[1]);
      flush();
      clearInterval(iv);
    }
  }, 700);
})();
</script>
</body>`;

s = s.replace('</body>', probe);
s = s.replace(/src="vendor\//g, 'src="../vendor/').replace(/src="src\//g, 'src="../src/');

fs.writeFileSync(path.join(root, 'tools/_probe.html'), s, 'utf8');
console.log('probe written');
