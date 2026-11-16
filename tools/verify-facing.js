// tools/verify-facing.js — 角色朝向验收
//
// 【为什么需要】
// 曾经 S.dir8FromAngle 里把"面向相机的世界角"算成了 cameraYaw + PI，
// 多出来的那个 PI 让整个朝向差 180°：
//   按 W（往屏幕上方走）→ 显示正面帧（能看到脸）→ 看起来像倒着走
//   按 S（往屏幕下方走）→ 显示背面帧（后脑勺）
//
// 这个 bug 很难被玩家立刻说清（用户描述成"停止移动后朝向自动复位"），
// 所以必须有断言把它钉住。
//
// 目标地址：默认本地 dev.html，也可传参测线上。
const path = require('path');
const { launchOwnChrome, sleep } = require('./cdp');
const ROOT = path.resolve(__dirname, '..');

const TARGET_URL = process.argv[2] ||
  ('file:///' + path.join(ROOT, 'dev.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?autostart=1&v=' + Date.now());

async function main() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail != null ? '  [' + detail + ']' : ''));
  }

  console.log('=== 角色朝向验收 ===');
  console.log('目标地址: ' + TARGET_URL + '\n');

  const b = await launchOwnChrome({ width: 1280, height: 720 });
  const cdp = b.cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const errors = [];
  cdp.on('Runtime.exceptionThrown', e => { errors.push(e.exceptionDetails.text || 'exception'); });

  await cdp.send('Page.navigate', { url: TARGET_URL });
  let booted = false;
  for (let i = 0; i < 80; i++) {
    await sleep(400);
    try {
      if (await cdp.eval(`(G.world.props&&G.world.props.length>0)?1:0`) === 1) { booted = true; break; }
    } catch (e) {}
  }
  check('游戏启动完成', booted);
  if (!booted) { await b.kill(); process.exit(1); }
  await sleep(1500);

  // 清掉开场，避免对话锁住输入
  await cdp.eval(`(function(){
    if (G.intro) { G.intro.stage = 3; G.intro.objective = null; }
    if (G.dlg && G.dlg.active) G.dlg.close();
    return 1;
  })()`);
  await sleep(400);

  // ---- 1. dir8 映射的语义 ----
  //
  // 约定（见 22-sprite.js）：dir8 = 0 面向相机，顺时针递增。
  // 相机 yaw=45° 时：
  //   W（屏幕上方、背对镜头）→ 4
  //   S（屏幕下方、面向镜头）→ 0
  //   A（屏幕左）→ 6
  //   D（屏幕右）→ 2
  const map = await cdp.eval(`(function(){
    var cases = [
      { n: 'W', ax: 0, az: -1 },
      { n: 'S', ax: 0, az: 1 },
      { n: 'A', ax: -1, az: 0 },
      { n: 'D', ax: 1, az: 0 }
    ];
    return cases.map(function(c){
      var d = G.camera.screenDirToWorld(c.ax, c.az);
      var ang = Math.atan2(d.x, d.z);
      return { n: c.n, dir8: G.sprite.dir8FromAngle(ang, G.camera.yaw) };
    });
  })()`);
  const got = {};
  map.forEach(m => { got[m.n] = m.dir8; });

  check('W（走向屏幕上方）→ dir8=4 背对镜头', got.W === 4,
    'W→' + got.W + '（期望 4）');
  check('S（走向屏幕下方）→ dir8=0 面向镜头', got.S === 0,
    'S→' + got.S + '（期望 0）');
  check('A（走向屏幕左侧）→ dir8=6 面朝左', got.A === 6,
    'A→' + got.A + '（期望 6）');
  check('D（走向屏幕右侧）→ dir8=2 面朝右', got.D === 2,
    'D→' + got.D + '（期望 2）');

  // ---- 2. dir8FromAngle 与 dirToCamera 必须一致 ----
  //
  // 这两个函数本是同一件事的两种写法，曾经推导分叉导致其中一个错了。
  // 现在 dir8FromAngle 直接复用 dirToCamera，这里钉住这个事实。
  const same = await cdp.eval(`(function(){
    var bad = [];
    var yaws = [0, Math.PI/4, Math.PI/2, Math.PI, -Math.PI/3];
    var angles = [];
    for (var i = 0; i < 16; i++) angles.push(-Math.PI + i * Math.PI / 8);
    yaws.forEach(function(y){
      angles.forEach(function(a){
        var x = G.sprite.dir8FromAngle(a, y);
        var y2 = G.sprite.dirToCamera(a, y);
        if (x !== y2) bad.push('yaw=' + y.toFixed(2) + ' ang=' + a.toFixed(2) + ' ' + x + '!=' + y2);
      });
    });
    return { mismatches: bad.length, sample: bad.slice(0, 3) };
  })()`);
  check('dir8FromAngle 与 dirToCamera 结果完全一致（80 组组合）',
    same.mismatches === 0, same.mismatches + ' 处不一致');

  // ---- 3. 真实按键：移动后朝向不自动复位 ----
  //
  // 用户的原始描述是"停止移动后朝向自动复位"，实测方向映射修正后，
  // 这里验证"朝向在停止后保持不变"这个行为本身是对的。
  const press = async (code, key, vk, ms) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk });
    await sleep(ms);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
  };

  const readFacing = () => cdp.eval(`(function(){
    var st = G.player.state;
    return {
      facing: +st.facing.toFixed(4),
      dir8: G.sprite.dir8FromAngle(st.facing, G.camera.yaw)
    };
  })()`);

  const dirs = [
    { n: 'W', code: 'KeyW', key: 'w', vk: 87, expectDir8: 4 },
    { n: 'S', code: 'KeyS', key: 's', vk: 83, expectDir8: 0 },
    { n: 'A', code: 'KeyA', key: 'a', vk: 65, expectDir8: 6 },
    { n: 'D', code: 'KeyD', key: 'd', vk: 68, expectDir8: 2 }
  ];

  for (const d of dirs) {
    // 【每次先把相机 yaw 归位】
    // 这个测试对 camYaw 敏感：dir8 是"世界朝向相对相机"的映射，
    // 相机一转，同一个移动方向的 dir8 就变了。
    // 前面若按过 R/Q，yaw 会停在非 45° 的位置，断言就会误报。
    await cdp.eval(`(function(){
      G.camera.yaw = Math.PI * 0.25;
      G.camera.yawTarget = Math.PI * 0.25;
      G.camera.cam.updateMatrixWorld(true);
      return 1;
    })()`);
    await sleep(200);

    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: d.code, key: d.key, windowsVirtualKeyCode: d.vk });
    await sleep(600);
    const during = await readFacing();
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: d.code, key: d.key, windowsVirtualKeyCode: d.vk });
    await sleep(900);
    const after = await readFacing();

    check('按 ' + d.n + ' 移动时朝向正确（dir8=' + d.expectDir8 + '）',
      during.dir8 === d.expectDir8, 'dir8=' + during.dir8);
    check('松开 ' + d.n + ' 后朝向保持不变（不复位）',
      Math.abs(after.facing - during.facing) < 0.001 && after.dir8 === during.dir8,
      during.dir8 + ' → ' + after.dir8);
  }

  // ---- 4. 相机旋转后朝向重新映射 ----
  //
  // 转动相机（Q/R）后，同一个世界朝向应映射到不同的 dir8。
  // 注意：这里只验证"会变化"，不锁定具体值 —— 因为相机 yaw 有平滑插值。
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await sleep(600);
  const beforeRotate = await readFacing();
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });

  await press('KeyR', 'r', 82, 120);
  await sleep(1200);
  const afterRotate = await cdp.eval(`(function(){
    var st = G.player.state;
    return {
      facing: +st.facing.toFixed(4),
      dir8: G.sprite.dir8FromAngle(st.facing, G.camera.yaw),
      camYaw: +G.camera.yaw.toFixed(3)
    };
  })()`);
  check('相机旋转后朝向被重新映射（世界朝向不变）',
    Math.abs(afterRotate.facing - beforeRotate.facing) < 0.001 &&
    afterRotate.dir8 !== beforeRotate.dir8,
    'dir8 ' + beforeRotate.dir8 + ' → ' + afterRotate.dir8 +
    '（camYaw=' + afterRotate.camYaw + '）');

  // ---- 5. 无错误 ----
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
