// tools/verify-aim.js — 端到端验证：普攻/技能方向是否跟随鼠标
//
// 【这个测试防的是什么】
// 曾出现"攻击方向不跟鼠标"的问题，有两个叠加的根因：
//  1) screenToGround 把射线打到固定的 y=0 平面。地形有高度（野外 1~9）时，
//     玩家在坡上，射线要先穿过 y=0，交点比鼠标实际指向远十几单位。
//     实测：城镇 0° 偏差，野外深处 34~120° 偏差。
//  2) 移动时 st.facing 被无条件改成"前进方向"，覆盖了鼠标朝向。
//     边跑边打时朝向永远跟移动走，鼠标指哪都没用。
//
// 【测试要点（踩过很多次）】
//  - 必须冻结相机：follow 是 lerp 插值的，算完屏幕坐标后相机若还在移动，
//    射线起点就变了，落点会完全不同（实测角度能差 40°+）。
//  - 不要手推帧让攻击执行：tickOnce -> step() -> player.update() 会跑移动逻辑，
//    可能覆盖朝向。用 sleep 让浏览器真实 rAF 执行。
//  - 技能带突进，事后玩家位置会变；期望方向必须用**施放瞬间**的位置算。
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  try { await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) {}
  await cdp.send('Page.navigate', {
    url: 'file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?v=' + Date.now()
  });
  await sleep(4500);

  const spots = [
    { name: '城镇', x: 0, z: 0 },
    { name: '野外深处', x: 0, z: 55 }
  ];

  let allPass = true;

  for (const s of spots) {
    console.log(`\n=== ${s.name} (x=${s.x}, z=${s.z}) ===`);

    // 站到该位置，把鼠标指向正东 4 单位处。
    //
    // 【关键：必须冻结相机跟随】
    // 相机 follow 是平滑插值的（lerp 0.13/帧）。如果在算屏幕坐标之后、
    // 攻击执行之前相机移动了，射线起点就变了，落点会完全不同。
    // 实测：同一 mouse 坐标，相机 follow.y 从 6.69 变到 9.44 时，
    // 落点角度从 1.719 变成 2.959 —— 这就是之前"看起来没修好"的真正原因。
    // 所以这里把 stickyCamera 打开，让 update() 不做插值。
    const setup = await cdp.eval(`(function(){
      var st = G.player.state;
      st.x = ${s.x}; st.z = ${s.z};
      st.attackCd = 0; st.moveLock = 0;
      var gY = G.world.groundY(st.x, st.z);

      // 冻结相机：直接钉到目标位置，并让 follow.y 与 groundY 一致
      G.camera.follow.x = st.x;
      G.camera.follow.z = st.z;
      G.camera.follow.y = gY + 0.6;
      G.camera.viewH = 24;
      G.camera.resize(16/9);
      G.camera.update(0.016, { x: st.x, z: st.z, y: gY + 0.6 });
      G.camera.cam.updateMatrixWorld(true);

      // 再钉一次，防止 update 里的插值又拉走
      G.camera.follow.x = st.x; G.camera.follow.z = st.z; G.camera.follow.y = gY + 0.6;
      G.camera.update(0.016, { x: st.x, z: st.z, y: gY + 0.6 });

      G.world.timeOfDay = 0.42;
      for (var i = 0; i < 5; i++) G.tickOnce(1/60);

      // 推帧后再钉一次（tickOnce 里的 step 会调 camera.update 做插值）
      G.camera.follow.x = st.x; G.camera.follow.z = st.z; G.camera.follow.y = gY + 0.6;
      G.camera.update(0.016, { x: st.x, z: st.z, y: gY + 0.6 });
      G.camera.cam.updateMatrixWorld(true);

      var tx = st.x + 4, tz = st.z;
      var tgy = G.world.groundY(tx, tz);
      var sp = G.camera.worldToScreen(tx, tgy, tz);
      var r = G.pixels.renderer.domElement.getBoundingClientRect();

      // 立刻用同样的 planeY 反投影验证一次（这一步应该准确）
      var verifyBack = G.camera.screenToGround(sp.x, sp.y, gY);

      return {
        groundY: +gY.toFixed(2),
        followY: +G.camera.follow.y.toFixed(2),
        targetX: tx, targetZ: tz, targetGroundY: +tgy.toFixed(2),
        screenX: sp.x, screenY: sp.y,
        selfCheckErr: +Math.hypot(verifyBack.x - tx, verifyBack.z - tz).toFixed(3),
        inBounds: sp.x >= r.left && sp.x <= r.left + r.width && sp.y >= r.top && sp.y <= r.top + r.height
      };
    })()`);
    console.log(`  玩家地面 y=${setup.groundY}, follow.y=${setup.followY}, 目标点 (${setup.targetX}, ${setup.targetZ}) 地面 y=${setup.targetGroundY}`);
    console.log(`  目标屏幕坐标 (${setup.screenX.toFixed(0)}, ${setup.screenY.toFixed(0)}) 在画布内=${setup.inBounds}  自检误差=${setup.selfCheckErr}`);

    if (!setup.inBounds) {
      console.log('  !! 目标点不在画布内，跳过');
      allPass = false;
      continue;
    }

    // 真实鼠标移动
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: setup.screenX, y: setup.screenY, button: 'none'
    });
    await sleep(120);

    // 校验 input.mouse 收到
    const mouseState = await cdp.eval(`({ x: G.input.mouse.x, y: G.input.mouse.y })`);
    console.log(`  input.mouse = (${mouseState.x}, ${mouseState.y})`);

    // 攻击。
    //
    // 【关键：不要用 G.tickOnce 推动】
    // 踩过的坑：以前在 mousePressed 之后调 G.tickOnce(1/60) 想"让攻击执行"，
    // 但 tickOnce -> step() -> player.update() 会执行移动逻辑，
    // 而 input.axis() 在 endFrame 之前可能残留状态，导致朝向被覆盖。
    // 正确做法：按下后 sleep 让浏览器**真实 rAF 主循环**执行攻击，
    // 然后读 facing。这样测的是玩家实际会经历的那条路径。
    const before = await cdp.eval(`G.player.state.facing`);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: setup.screenX, y: setup.screenY,
      button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse'
    });
    // 等真实 rAF 跑几帧（攻击在 250ms 内完成）
    await sleep(350);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: setup.screenX, y: setup.screenY,
      button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse'
    });
    await sleep(100);

    const after = await cdp.eval(`(function(){
      var st = G.player.state;
      var expected = Math.atan2(${setup.targetX} - st.x, ${setup.targetZ} - st.z);
      var diff = Math.atan2(Math.sin(st.facing - expected), Math.cos(st.facing - expected));
      return {
        facing: +st.facing.toFixed(3),
        expected: +expected.toFixed(3),
        errDeg: +Math.abs(diff * 180 / Math.PI).toFixed(1)
      };
    })()`);

    const ok = after.errDeg < 15;
    if (!ok) allPass = false;
    console.log(`  facing ${before.toFixed(2)} -> ${after.facing}, 期望 ${after.expected}, 误差 ${after.errDeg}°  ${ok ? 'PASS' : '<<< FAIL'}`);
  }

  // ---- 技能同样验证 ----
  console.log('\n=== 技能方向（野外深处）===');
  const skillTest = await cdp.eval(`(function(){
    var st = G.player.state;
    st.x = 0; st.z = 55;
    st.skillUnlocked[1] = true;
    st.skills[1] = { cd: 0 };
    var gY = G.world.groundY(0, 55);

    // 同样必须冻结相机（理由见上面 basicAttack 的注释）
    G.camera.follow.x = 0; G.camera.follow.z = 55; G.camera.follow.y = gY + 0.6;
    G.camera.viewH = 24; G.camera.resize(16/9);
    G.camera.update(0.016, { x: 0, z: 55, y: gY + 0.6 });
    G.camera.cam.updateMatrixWorld(true);
    for (var i = 0; i < 5; i++) G.tickOnce(1/60);
    G.camera.follow.x = 0; G.camera.follow.z = 55; G.camera.follow.y = gY + 0.6;
    G.camera.update(0.016, { x: 0, z: 55, y: gY + 0.6 });
    G.camera.cam.updateMatrixWorld(true);

    // 目标正北（z-4）
    var tx = st.x, tz = st.z - 4;
    var tgy = G.world.groundY(tx, tz);
    var sp = G.camera.worldToScreen(tx, tgy, tz);
    return {
      screenX: sp.x, screenY: sp.y,
      targetX: tx, targetZ: tz,
      // 记录施放瞬间的玩家位置 —— 技能带突进，事后位置会变，期望方向必须用它
      startX: st.x, startZ: st.z,
      groundY: +gY.toFixed(2)
    };
  })()`);
  console.log(`  技能目标 (${skillTest.targetX}, ${skillTest.targetZ}) 屏幕 (${skillTest.screenX.toFixed(0)}, ${skillTest.screenY.toFixed(0)})`);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: skillTest.screenX, y: skillTest.screenY, button: 'none'
  });
  await sleep(120);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Digit1', key: '1', windowsVirtualKeyCode: 49 });
  // 同样等真实 rAF（不要手推帧，避免与主循环抢时序）
  await sleep(350);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Digit1', key: '1', windowsVirtualKeyCode: 49 });
  await sleep(100);

  const skillResult = await cdp.eval(`(function(){
    var st = G.player.state;
    // 期望方向必须在**攻击发生前**记录的目标点算，
    // 而技能1（月影斩）带 4.2 单位突进，玩家位置会大幅改变。
    // 所以不能用"当前玩家位置 -> 目标点"重算期望，
    // 应该用"技能施放瞬间的朝向"判断。
    // 这里换个判据：技能造成的突进方向应与鼠标指向一致。
    var expected = Math.atan2(${skillTest.targetX} - ${skillTest.startX}, ${skillTest.targetZ} - ${skillTest.startZ});
    var diff = Math.atan2(Math.sin(st.facing - expected), Math.cos(st.facing - expected));
    return {
      facing: +st.facing.toFixed(3),
      expected: +expected.toFixed(3),
      errDeg: +Math.abs(diff * 180 / Math.PI).toFixed(1),
      pos: [+st.x.toFixed(2), +st.z.toFixed(2)]
    };
  })()`);
  const skillOk = skillResult.errDeg < 15;
  if (!skillOk) allPass = false;
  console.log(`  技能1 facing=${skillResult.facing}, 期望 ${skillResult.expected}, 误差 ${skillResult.errDeg}°  ${skillOk ? 'PASS' : '<<< FAIL'}`);

  // ---- 移动中攻击：朝向必须跟随鼠标，不能被移动方向覆盖 ----
  //
  // 这是本次修复的核心场景。修复前：按住 W 往北走，
  // 鼠标指向东边，攻击朝向却是北（跟着移动方向）。
  console.log('\n=== 移动中攻击（核心回归）===');
  const movingTest = await cdp.eval(`(function(){
    var st = G.player.state;
    st.x = 0; st.z = 55;
    st.attackCd = 0; st.moveLock = 0; st.actionLock = 0;
    var gY = G.world.groundY(0, 55);
    G.camera.follow.x = 0; G.camera.follow.z = 55; G.camera.follow.y = gY + 0.6;
    G.camera.viewH = 24; G.camera.resize(16/9);
    G.camera.update(0.016, { x: 0, z: 55, y: gY + 0.6 });
    G.camera.cam.updateMatrixWorld(true);
    for (var i = 0; i < 5; i++) G.tickOnce(1/60);
    G.camera.follow.x = 0; G.camera.follow.z = 55; G.camera.follow.y = gY + 0.6;
    G.camera.update(0.016, { x: 0, z: 55, y: gY + 0.6 });
    G.camera.cam.updateMatrixWorld(true);

    // 鼠标指向正东（+X 4 单位）
    var sp = G.camera.worldToScreen(4, G.world.groundY(4, 55), 55);
    return { screenX: sp.x, screenY: sp.y, startX: st.x, startZ: st.z };
  })()`);

  // 先把鼠标移到东边
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: movingTest.screenX, y: movingTest.screenY, button: 'none'
  });
  await sleep(100);

  // 按住 W（往北走）+ 同时攻击
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await sleep(120);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: movingTest.screenX, y: movingTest.screenY,
    button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse'
  });
  await sleep(250);
  const movingResult = await cdp.eval(`(function(){
    var st = G.player.state;
    var expected = Math.atan2(4 - ${movingTest.startX}, 55 - ${movingTest.startZ});
    var diff = Math.atan2(Math.sin(st.facing - expected), Math.cos(st.facing - expected));
    return {
      facing: +st.facing.toFixed(3),
      expected: +expected.toFixed(3),
      errDeg: +Math.abs(diff * 180 / Math.PI).toFixed(1),
      movingKeys: Object.keys(G.input.keys).filter(function(k){ return G.input.keys[k]; }).join(',')
    };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: movingTest.screenX, y: movingTest.screenY,
    button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse'
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });

  const movingOk = movingResult.errDeg < 20;
  if (!movingOk) allPass = false;
  console.log(`  按住 W 移动时攻击：facing=${movingResult.facing} 期望=${movingResult.expected} 误差=${movingResult.errDeg}°  ${movingOk ? 'PASS' : '<<< FAIL（朝向被移动方向覆盖）'}`);

  console.log('\n=== 总判定: ' + (allPass ? 'PASS' : 'FAIL') + ' ===');
  await b.kill();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
