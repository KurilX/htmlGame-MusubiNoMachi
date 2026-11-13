# AGENTS.md — 結ノ町

## 这是什么

单文件、双击即玩的**和风幻想动作 RPG**。零依赖、零网络、零外部资源：
整个游戏就是一个 `game.html`（约 1.05 MB，内联全部代码与程序化贴图）。
不是 MMO，是"有 MMO 世界结构感的单人动作 RPG"。

线上：https://kurilx.github.io/htmlGame-MusubiNoMachi/

## 怎么跑

```bash
node build.mjs                 # 构建单文件 game.html
node tools/verify-d1.js        # 玩法验收 20 项
node tools/verify-build.js     # 单文件验收 21 项
node tools/verify-online.js    # 线上验收 19 项
node tools/verify-vfx.js       # 特效验收 6 项
node tools/verify-aim.js       # 瞄准验收（可传 URL 测线上）
node tools/verify-quest.js     # 任务系统 19 项
node tools/verify-perf.js      # 性能 6 项
node tools/verify-dungeon.js   # 副本系统 23 项
node tools/shot-natural.js <x> <z> out.png   # 用游戏相机截图
```

开发用 `dev.html`（多文件，可直接 `file://` 打开）；
交付物 `game.html` 由 `build.mjs` 把 `src/` 全部内联生成，**不要手改**。

## 技术栈与硬约束

- **Three.js r160 UMD 内联**（classic script）。`file://` 下 ESM 跨文件被 CORS 拦，不能用 module。
- **全部贴图程序化生成**（`src/12-textures.js` 用 canvas 画）。零图片文件。
- **禁止 `fetch` / `XHR`**。`file://` 下读本地文件会失败，数据全写成 JS 字面量放 `src/data/`。
- 存档走 `localStorage` + JSON 导出兜底。
- 渲染管线：场景 → 离屏 RT(1152×648) → Sobel 描边 → 屏幕。

## 目录约定

```
src/00-core.js      命名空间 G、数学、RNG、配色
src/1x-*.js         渲染底层（着色器/管线/贴图/彩色阴影）
src/2x-*.js         美术（角色立绘 / 场景物件 / 新地区素材）
src/3x-*.js         相机、输入
src/4x-*.js         玩家、敌人、技能、战斗、特效
src/5x-*.js         世界与地形
src/6x-7x-8x-9x.js  背包、任务、UI、对话、音频、存档、主循环
src/data/*.js       纯 JS 字面量数据
tools/              CDP 验收与截图脚本
```

新增脚本必须同时加到 `dev.html` 和 `build.mjs` 的脚本清单，否则 `game.html` 里不会有。

## 验收铁律

1. **不接受"看着没问题"**。所有结论用 CDP 发送真实键鼠事件 + 读回渲染结果验证。
2. **绝不硬编码 CDP 端口**。本机 9333 是用户正在用的 Amlcowork 桌面客户端，
   `tools/cdp.js` 用动态端口 + 三重归属校验。曾因为写死端口把测试页导航进用户的窗口。
3. **测线上必须确认真的加载了线上**。**这个错误已经犯了三次**
   （`verify-aim` / `verify-perf` / `verify-quest`），每次都是把 URL 写死成
   `dev.html`、传参被静默忽略，然后把本地结果当成线上验收。
   硬规则：**任何验收脚本必须从 `process.argv[2]` 读 URL，并在开头打印真实加载地址**。
4. 截图用 `shot-natural.js`（走游戏自身的跟随相机），不要手动改相机参数——
   手工设 viewH 得到的画面可能和玩家实际所见不一致。
5. **性能断言不要用绝对帧率做门禁**。headless Chrome 受宿主负载影响，
   同一份代码实测在 38~60 fps 间浮动（本机可用内存常只剩 2~3 GB）。
   判据要用稳定的指标（缓存命中耗时、单次操作耗时），帧率只记录不判定。

## 当前状态（2026-11-13）

**已完成**：战斗手感、5.5 头身角色、彩色阴影、程序化材质、多区域地形、
280×270 单张连续大世界（5 个可玩地区）、性能优化（draw calls 1481→883）、
**任务系统（結ノ町主线 6 章 + 3 条支线 + 新手引导 + 任务日志 UI）**、
**副本系统（独立场景切换 + 3 副本 + 2 个新 Boss）**。

**未完成**：
- 神山 / 湊町 / 渚 各自的主线（结构已就绪，只需加数据 + 在 `QUEST_LINES` 注册）。
- 城镇扩大、NPC 扩到 12~14、支线扩到 8~12 条。
- 副本内可以补机关、宝箱、中途存档点。
- `docs/ISSUE-blue-region.md` 记录的蓝色区域视觉缺陷。

**已知性能问题**：线上首访启动约 25 秒（本地 4~6 秒），瓶颈在 `W.build` 的物件构建与 shader 编译。

## 任务系统约定（加新城镇主线时看这里）

- 任务 id 用 `地区_章节_序号`（如 `town_01`），必须有 `region` 与 `chapter` 字段
- `chapter > 0` 视为主线，`chapter === 0` 视为支线（UI 据此分组与排序）
- 新城镇只需：在 `src/data/quests.js` 加任务数据 + 在 `G.DATA.QUEST_LINES` 注册一条链
- 步骤类型（由 `61-quest.js` 的钩子消费）：
  `talk` / `kill`（count）/ `boss` / `knot` / `collect`（count）/ `reach`
- `reach` 靠 `Q.checkReach(dt, player)` 轮询判定（此前 `onReach` 没有任何调用点，是个 bug）
- 任务状态由 `80-save.js` 的 `quest` 字段存盘（此前完全没存，读档会清零）

## 副本系统约定（加新副本时看这里）

- 副本定义在 `src/data/zones.js` 的 `G.DATA.DUNGEONS`，
  运行时在 `src/53-dungeon.js`
- 每个副本必须有 `gateUid`（对应世界里的 gate 交互物）、`rooms`（数组，
  最后一间是 `boss`）
- **进入方式是整体替换 `G.world.scene`**，不是在大地图上围区域。
  安全前提：全项目对场景的引用都走 `G.world.scene`，没有缓存引用
- `W.groundY` 在 `inDungeon` 时返回 0（副本是平地）
- 场景切换后必须调 `G.camera.snap()`，否则相机会从旧位置插值
- 新增 Boss 时注意：生成位置要离玩家入口足够远（>3 单位），
  否则 Boss 体型大会把玩家糊住；出口要离玩家出生点远，否则会被立刻传送走

## 踩过的坑（改代码前先看）

- **特效 y 坐标不能写死**。用 `G.fx.atGround(x, z, lift)`，否则出村后特效埋进地里。
- **地形高度必须连续**。区域权重混合会在交界处产生 17~18 单位断层（等于悬崖）；
  用"基础地形 + 特征叠加"（只有加法，无除法归一化）。
- **材质 clone 很贵**。每次 `clone()` + `needsUpdate` 会重建 WebGLProgram；
  按源材质 UUID 缓存。曾因反复 clone 让启动从 2s 涨到 21s。
- **`texCached` 的缓存 key 不能带 seed**，否则每个 seed 重新生成一张纹理。
- **共享材质被标 `vertexColors` 会污染其他 mesh**（没有 color 属性的渲染成纯黑）。
- **正交相机 near/far 别乱放大**（试过 near=-200 直接全屏黑）。
- 测试里等页面启动要**轮询**，不要固定 `sleep`——启动时间会随内容增长而变化。
