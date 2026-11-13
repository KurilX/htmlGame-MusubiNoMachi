// tools/verify-dungeon.js — 副本系统验收
//
// 覆盖：三个副本定义 / 进出场景切换 / groundY 切换 / 房间推进 /
//       Boss 召唤与击杀 / 出口传送门 / 场景恢复 / 无内存泄漏
//
// 目标地址：默认本地 dev.html，也可传参测线上：
//   node tools/verify-dungeon.js https://kurilx.github.io/htmlGame-MusubiNoMachi/game.html
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

const TARGET_URL = process.argv[2] ||
  ('file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now());

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 副本系统验收 ===');
  console.log('目标地址: ' + TARGET_URL + '\n');

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const errors = [];
  cdp.on('Runtime.exceptionThrown', e => {
    errors.push(e.exceptionDetails.text || 'exception');
  });

  await cdp.send('Page.navigate', { url: TARGET_URL });
  let booted = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const ok = await cdp.eval(`(typeof G!=='undefined'&&G.world&&G.world.props&&G.world.props.length>0)?1:0`);
      if (ok === 1) { booted = true; break; }
    } catch (e) {}
  }
  check('游戏启动完成', booted);
  if (!booted) { await b.kill(); process.exit(1); }
  await sleep(2000);

  // ---- 1. 三个副本定义 ----
  const defs = await cdp.eval(`(function(){
    var all = G.DATA.DUNGEONS || {};
    var out = [];
    for (var k in all) {
      var d = all[k];
      out.push({
        id: k, name: d.name, gate: d.gateUid, rooms: d.rooms.length,
        boss: d.rooms[d.rooms.length - 1].boss,
        bossExists: !!(G.DATA.MONSTERS[d.rooms[d.rooms.length - 1].boss])
      });
    }
    return out;
  })()`);
  check('副本数量 = 3', defs.length === 3, defs.map(d => d.id).join(', '));
  check('每个副本都有入口 gate', defs.every(d => !!d.gate),
    defs.map(d => d.gate).join(', '));
  check('每个副本都有 Boss', defs.every(d => !!d.boss && d.bossExists),
    defs.map(d => d.id + ':' + d.boss).join(', '));

  // ---- 2. 新 Boss 数据完整 ----
  const bosses = await cdp.eval(`(function(){
    var ids = ['musubi_no_kami', 'iwakaguri', 'shio_no_onna'];
    return ids.map(function(id){
      var m = G.DATA.MONSTERS[id];
      return m ? { id: id, name: m.name, hp: m.hp, atk: m.atk, tier: m.tier,
                   hasLook: !!m.look, phases: (m.phases || []).length } : { id: id, missing: true };
    });
  })()`);
  check('三个 Boss 数据齐全（含 look 与 phases）',
    bosses.every(x => !x.missing && x.tier === 'boss' && x.hasLook && x.phases >= 2),
    bosses.map(x => x.name + '(' + x.hp + ')').join(' '));

  // ---- 3. 进入副本：场景切换 ----
  const enter = await cdp.eval(`(function(){
    var beforeChildren = G.world.scene.children.length;
    var beforeIn = G.world.inDungeon;
    var beforeScene = G.world.scene;
    var ok = G.dungeon.enter('wasureo');
    return {
      ok: ok,
      beforeChildren: beforeChildren,
      afterChildren: G.world.scene.children.length,
      sceneChanged: G.world.scene !== beforeScene,
      inDungeon: G.world.inDungeon,
      wasInDungeon: beforeIn
    };
  })()`);
  check('能进入副本', enter.ok === true);
  check('场景被整体替换', enter.sceneChanged === true,
    enter.beforeChildren + ' -> ' + enter.afterChildren + ' 个对象');
  check('inDungeon 标记已置位', enter.inDungeon === true && enter.wasInDungeon === false);

  // ---- 4. groundY 在副本内为 0 ----
  const ground = await cdp.eval(`(function(){
    return {
      at0: G.world.groundY(0, 0),
      atMinus40: G.world.groundY(0, -40),
      playerGround: G.world.groundY(G.player.state.x, G.player.state.z)
    };
  })()`);
  check('副本内 groundY 恒为 0（平的）',
    ground.at0 === 0 && ground.atMinus40 === 0 && ground.playerGround === 0);

  // ---- 5. 第一间房有敌人 ----
  const room1 = await cdp.eval(`(function(){
    var r = G.dungeon.currentRoom();
    var list = G.dungeon.roomEnemies[r.id] || [];
    return { room: r.name, count: list.length, allAlive: list.every(function(e){ return !e.dead; }) };
  })()`);
  check('第一间房已刷怪', room1.count > 0, room1.room + ' ' + room1.count + ' 只');

  // ---- 6. 清空后推进 ----
  await cdp.eval(`(function(){
    var r = G.dungeon.currentRoom();
    (G.dungeon.roomEnemies[r.id] || []).forEach(function(e){ e.dead = true; e.hp = 0; });
    return 1;
  })()`);
  await sleep(2600);
  const advanced = await cdp.eval(`(function(){
    var r = G.dungeon.currentRoom();
    var p = G.dungeon.progress();
    return { index: G.dungeon.roomIndex, room: r ? r.name : null,
             cleared: p ? p.cleared : 0, total: p ? p.total : 0 };
  })()`);
  check('清空当前房间后自动推进到下一间', advanced.index >= 1,
    '现在在「' + advanced.room + '」进度 ' + advanced.cleared + '/' + advanced.total);

  // ---- 7. 玩家被移进新房间 ----
  const moveCheck = await cdp.eval(`(function(){
    var r = G.dungeon.currentRoom();
    var st = G.player.state;
    var dx = Math.abs(st.x - r.x);
    var dz = Math.abs(st.z - (r.z + r.d / 2 - 2.5));
    return { inRoomX: dx < 1, inRoomZ: dz < 1, playerX: +st.x.toFixed(1), playerZ: +st.z.toFixed(1) };
  })()`);
  check('推进时玩家被送进新房间入口', moveCheck.inRoomX && moveCheck.inRoomZ,
    '(' + moveCheck.playerX + ', ' + moveCheck.playerZ + ')');

  // ---- 8. Boss 房 ----
  const bossRoom = await cdp.eval(`(function(){
    var rooms = G.dungeon.data.rooms;
    G.dungeon._spawnRoom(rooms.length - 1);
    var room = rooms[rooms.length - 1];
    var list = G.dungeon.roomEnemies[room.id] || [];
    var boss = list[0];
    var st = G.player.state;
    return {
      roomName: room.name,
      spawned: list.length,
      bossName: boss ? boss.def.name : null,
      bossHp: boss ? boss.maxHp : 0,
      distance: boss ? +Math.hypot(boss.x - st.x, boss.z - st.z).toFixed(1) : 0
    };
  })()`);
  check('Boss 房生成 Boss', bossRoom.spawned === 1, bossRoom.bossName + ' HP=' + bossRoom.bossHp);
  check('Boss 与玩家保持战斗距离（>3 且 <房间深度）',
    bossRoom.distance > 3 && bossRoom.distance < 20, bossRoom.distance + ' 单位');

  // ---- 9. 击杀 Boss 开出口 ----
  await cdp.eval(`(function(){
    var room = G.dungeon.currentRoom();
    (G.dungeon.roomEnemies[room.id] || []).forEach(function(e){ e.dead = true; e.hp = 0; });
    return 1;
  })()`);
  await sleep(1600);
  const exit = await cdp.eval(`(function(){
    var p = G.dungeon.exitPortal;
    return {
      exists: !!p,
      atExitWhenStanding: p ? G.dungeon.atExit({ x: p.x, z: p.z }) : false,
      atExitWhenFar: p ? G.dungeon.atExit({ x: p.x + 20, z: p.z }) : true
    };
  })()`);
  check('击杀 Boss 后开启出口传送门', exit.exists === true);
  check('站在传送门上判定为 true', exit.atExitWhenStanding === true);
  check('离开传送门判定为 false', exit.atExitWhenFar === false);

  // ---- 10. 离开副本：场景恢复 ----
  const leave = await cdp.eval(`(function(){
    var beforeChildren = G.world.scene.children.length;
    var dungeonScene = G.world.scene;
    var posBefore = { x: G.player.state.x, z: G.player.state.z };
    var ok = G.dungeon.leave();
    return {
      ok: ok,
      sceneChangedBack: G.world.scene !== dungeonScene,
      inDungeon: G.world.inDungeon,
      children: G.world.scene.children.length,
      dungeonChildren: beforeChildren,
      playerPos: [+G.player.state.x.toFixed(1), +G.player.state.z.toFixed(1)],
      groundY: +G.world.groundY(G.player.state.x, G.player.state.z).toFixed(2)
    };
  })()`);
  check('能离开副本', leave.ok === true);
  check('场景切回大地图', leave.sceneChangedBack === true && leave.inDungeon === false,
    '副本 ' + leave.dungeonChildren + ' -> 大地图 ' + leave.children + ' 个对象');
  check('玩家回到进入前的位置', leave.playerPos[0] === 0 && leave.playerPos[1] === 6,
    '(' + leave.playerPos.join(',') + ')');

  // ---- 11. groundY 恢复为地形高度 ----
  const restore = await cdp.eval(`(function(){
    G.player.state.x = 0; G.player.state.z = 100;
    return { h: +G.world.groundY(0, 100).toFixed(2) };
  })()`);
  check('离开后 groundY 恢复大地图地形高度（非 0）', restore.h > 1, 'h=' + restore.h);

  // ---- 12. 三段式进出不泄漏 ----
  const leak = await cdp.eval(`(function(){
    var base = G.pixels.renderer.info.memory.geometries;
    for (var i = 0; i < 3; i++) {
      G.dungeon.enter('shio');
      G.dungeon.leave();
    }
    return {
      before: base,
      after: G.pixels.renderer.info.memory.geometries,
      delta: G.pixels.renderer.info.memory.geometries - base
    };
  })()`);
  check('反复进出 3 次不泄漏几何体（Δ <= 6）', leak.delta <= 6,
    '几何体 ' + leak.before + ' -> ' + leak.after + ' (Δ' + leak.delta + ')');

  // ---- 13. 无错误 ----
  check('全程无 JS 错误', errors.length === 0, errors.length + ' errors');

  await b.kill();

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log('\n=== 结果: ' + pass + '/' + results.length + ' 通过 ===');
  if (fail) {
    console.log('\n失败项：');
    results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name + '  ' + (r.detail || '')));
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试异常:', e); process.exit(2); });
