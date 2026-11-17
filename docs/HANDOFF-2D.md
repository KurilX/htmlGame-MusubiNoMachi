# 交接文档 — 《結ノ町》2D 重构

> 写给接手这个项目的下一个会话 / 下一个人。
> 读完这份文档，你应该知道：**现在是什么状态、为什么是这样、下一步做什么、以及哪些坑不要再踩**。
>
> 文档时间：2026-11-17　仓库：`KurilX/htmlGame-MusubiNoMachi`　HEAD：`a68c24d`

---

## 一、一句话现状

游戏正在从 **3D 等距** 迁移到 **纯 Canvas 2D 像素风（RPG Maker 风格）**。

- **3D 版**：功能完整（5 地区 / 14 NPC / 3 副本 / 31 任务），走默认路径 `game.html`
- **2D 版**：只有基础骨架（1 个城镇 / 4 栋房 / 4 NPC / 可走动），走 `game.html?mode=2d`

**两条路线并存，互不影响。** 2D 是主攻方向，3D 作为保底版本暂时不删。

### 2D 版逐项清单（已核实，不是估计）

| 功能 | 状态 | 说明 |
|---|---|---|
| 瓦片地图 | ✅ | 40×30 格 |
| 草地 / 土路 | ✅ | 十字路口 |
| 房屋 | ⚠️ **只有屋顶** | 没有墙、门、窗，看起来像红色地毯 |
| 玩家移动 | ✅ | WASD，分轴碰撞可沿墙滑动 |
| 四方向朝向 | ✅ | 上=1 下=0 左=2 右=3 |
| 行走动画 | ✅ | 每方向 7 帧 |
| 碰撞 | ✅ | 实心格 + 不可通行瓦片 |
| 相机跟随 | ✅ | 平滑，60 单位内的收敛 |
| 角色外观 | ✅ | 5 套（发型+和服+腰带） |
| HUD | ✅ | 血条 / 等级 / 金钱 / 技能栏 |
| NPC | ⚠️ **站着不动** | 4 个，会朝玩家转身 |
| NPC 名字 | ❌ | **数据里有 `name` 字段，但没有任何代码绘制** |
| 对话 | ❌ | 无 |
| 任务 | ❌ | 无 |
| 敌人 | ❌ | 无 |
| 战斗 | ❌ | 无 |
| 技能 | ❌ | 无（HUD 的技能栏是空的） |
| 特效 | ❌ | 无 |
| 室内 | ❌ | 无 |
| 副本 | ❌ | 无 |
| 其他 4 个地区 | ❌ | 无 |

**一句话**：能走、能看、HUD 在，但**没有交互、没有战斗、没有剧情**。

---

## 二、为什么会有 2D 这条路线（重要历史）

用户最初要求「画风改成 RPG Maker 那种 2D 俯视像素风」。这条路走了 **4 次**，前 3 次全部失败，原因是同一个：

**拿 3D 相机 + 3D 几何去「模拟」2D 俯视。**

| 尝试 | 做法 | 用户看到的症状 |
|---|---|---|
| 1 | 3D 场景里平铺俯视贴图 | **图层互相穿透** |
| 2 | 90° 正俯视 | **角色直接没了** |
| 3 | 62° 斜俯视 + 素材图集 | **纹理全是混乱的、看不清房子** |
| 4 | **纯 Canvas 2D，不建 3D 场景** | ✅ 用户确认「对味了」 |

### 为什么第 4 次成了

2D 游戏**不需要**深度缓冲、正交相机、billboard。去掉这三样，之前三个 bug 自动消失：

| 之前的 bug | 2D 为什么不会发生 |
|---|---|
| 图层穿透 | 按 `sortY` 排序依次绘制，后画的一定在上面 |
| 角色消失 | 精灵是固定 32×64 的 2D 图，永远正对镜头 |
| 纹理混乱 | `drawImage(img, sx, sy, 16, 16, ...)` 按像素裁切，所见即所得 |

**这是本项目最重要的教训：换表现形式时，不要在新架构里复用旧架构的渲染假设。**

---

## 三、2D 架构（接手必读）

### 渲染链路

```
Canvas 2D（不用 WebGL，不建 three.js 场景）
  ↓
瓦片地图（16px 素材 × 2 倍 = 32px 一格）
  ↓
drawImage 按像素矩形裁切
  ↓
精灵按 sortY 排序绘制（画家算法）
  ↓
present()：离屏画布 → 屏幕画布（最近邻放大）
```

### 六个模块

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/50-canvas2d.js` | 249 | 渲染层：离屏画布、像素缩放、2D 相机、瓦片绘制、按 y 排序精灵、`present()` |
| `src/51-rpg16-tiles.js` | 177 | 瓦片索引（**坐标经严格验证**）+ 角色帧 + 可通行判定 |
| `src/52-world2d.js` | 307 | 世界：40×30 瓦片地图、碰撞、移动、动画、绘制 |
| `src/53-boot2d.js` | 141 | 2D 启动器，**独立主循环**（不碰 3D 的 main loop） |
| `src/54-hud2d.js` | 85 | HUD 桥接：提供 `G.player.state` 替身，让现有 HUD 能用 |
| `src/55-char-skin.js` | 212 | 角色外观合成：程序化叠发型 / 和服 / 腰带 |

### 怎么启用

```
game.html?mode=2d     ← 2D 版
game.html             ← 3D 版（原样）
```

分流点在 `src/91-main.js` 的 `G.boot()` 最开头。

### 坐标系（容易搞混）

| 概念 | 含义 |
|---|---|
| **瓦片格** | 地图数组的索引单位，16px 素材 |
| **世界像素** | `格 × TILE(32)`，玩家坐标用这个 |
| **屏幕像素** | `世界像素 − 相机偏移` |

`R.w2c(wx, wy)` 做世界→画布转换。

---

## 四、素材（关键：坐标不能猜）

### 当前使用的素材

**OpenGameArt "16x16 RPG Tileset"**（CC-BY-SA 3.0 + GPL）
https://opengameart.org/content/16x16-rpg-tileset

位于 `assets/rpg16/`，14 个文件、220 KB：

```
1_terrain.png          480×768   30×48 格   地形
2_indoors.png          320×352   20×22 格   室内
3_plants.png           480×128   30×8 格    植物
4_buildings.png        384×384   24×24 格   墙/窗/门
5_waterfall.png        288×320   18×20 格   水
6_floors.png           288×224   18×14 格   地板
7_grass_cliff.png      560×192   35×12 格   草地悬崖
8_cave.png             448×256   28×16 格   洞穴
9_beach.png            288×256   18×16 格   沙滩
10_dirt.png            224×320   14×20 格   泥土
11_roofs.png           512×512   32×32 格   屋顶
12_extra1.png          160×256   10×16 格   杂项
13_extra2.png          192×192   12×12 格   杂项
14_human_sprite_base.png  224×256          角色（**裸模**）
```

### 角色图集规格（实测，别再猜）

```
图集 224×256
每帧 32×64
4 行 = 下 / 上 / 左 / 右
每行 7 帧（0=站立，1~6=行走循环）
```

### 素材坐标是怎么确定的（这是最容易翻车的地方）

**前几轮"纹理混乱"的根因就是坐标靠猜。** 正确做法是两步：

1. **严格筛选**：100% 不透明 + 颜色方差 < 900 + 非纯黑纯白
2. **人工核对**：把候选裁出来拼成对照图，逐块看

已知正确的坐标（已验证）：

```js
grass      row=0,  col=6      // 1_terrain
grass2     row=0,  col=7
stone      row=24, col=6
dirt       row=0,  col=6      // 10_dirt
sand       row=8,  col=2      // 9_beach
water      row=8,  col=2      // 5_waterfall
floorWood  row=1,  col=1      // 6_floors
roof       row=0,  col=8      // 11_roofs
wall       row=3,  col=18     // 4_buildings
```

**做新瓦片时，务必先写脚本验证坐标，不要直接写进代码。**

### 废弃的素材（别再找）

| 素材 | 为什么不能用 |
|---|---|
| LPC `terrain_atlas.png` | 只有自然地形，**没有建筑** |
| `exterior_32.png` | 建筑是**斜俯视**，和 2D 正俯视不匹配 |
| `minishcap.png` | **是对话框边框**，不是地形 |
| `16x16_Jetom.png` | **是图标集**，单色橙调 |
| `the-field-of-the-floating-islands` | **侧视平台跳跃**，不是俯视 |

`assets/pack/` 是上一轮（PR #17）为 3D 版准备的角色素材，现在 2D 用不上，
但 3D 路线还在引用，**不要删**。

---

## 五、复用性分析（决定工作量）

实测各模块对 three.js 的依赖程度：

| 模块 | THREE | scene | mesh | 结论 |
|---|---|---|---|---|
| `44-combat.js` 战斗判定 | 0 | 0 | 0 | ✅ **直接复用** |
| `61-quest.js` 任务 | 0 | 0 | 0 | ✅ **直接复用** |
| `80-save.js` 存档 | 0 | 0 | 0 | ✅ **直接复用** |
| `70-ui.js` HUD | 0 | 0 | 0 | ✅ **直接复用**（已接） |
| `72-dialog.js` 对话 | 0 | 0 | 0 | ✅ **直接复用** |
| `42-skills.js` 技能 | 0 | 0 | 1 | 改 1 处 |
| `40-player.js` 玩家 | 0 | 2 | 2 | 换渲染层 |
| `41-enemy.js` 敌人 | 3 | 4 | 19 | 换渲染层 |
| `45-vfx.js` 特效 | **55** | 4 | 0 | ❌ **必须重写** |

**关键结论**：战斗、任务、存档、UI、对话全部与渲染解耦。
只有特效必须重写成 Canvas 2D。

---

## 六、下一步：6 批计划

工单：#21　https://github.com/KurilX/htmlGame-MusubiNoMachi/issues/21

按 **1 → 2 → 3 → 4 → 5 → 6** 推进，**每批做完先给用户看，确认再继续**。

### 批次 1 · 城镇细节 ← **从这里开始**
让城镇看起来像真城镇，而不是空地上几块屋顶。

- 房子改成完整外观：**屋顶 + 墙 + 门 + 窗**（`4_buildings` + `11_roofs`）
- 房屋 4~5 格高，做出纵深感
- 加围栏、石灯笼、招牌、树、灌木（`3_plants`）
- 石板路替代土路（`6_floors`）
- 草地边缘过渡，避免方块感

### 批次 2 · NPC 与对话
- NPC 走动 / 朝向玩家
- 靠近显示「E 交谈」
- 接 `72-dialog.js`（可直接复用）
- NPC 头顶名字
- 接 `61-quest.js`（可直接复用）接任务

### 批次 3 · 战斗系统
- 敌人精灵、AI 追击（复用 `41-enemy.js` 逻辑）
- 鼠标左键普攻扇形判定（复用 `44-combat.js`）
- 1-4 技能（复用 `42-skills.js`）
- 伤害数字、受击闪白、掉落拾取

### 批次 4 · 特效重写
`45-vfx.js` 的 55 处 THREE 全部重写成 Canvas 2D：
- 刀光（弧形渐变）、粒子、屏幕震动、命中定格
- **技能预警范围必须与判定范围严格一致**

### 批次 5 · 室内与副本
- 房屋室内地图（`2_indoors`）
- 3 个副本（忘れ緒の社 / 岩融の窟 / 潮の淵）
- Boss 战

### 批次 6 · 其余 4 个地区
- 霞ヶ原 / 神山 / 湊町 / 渚
- 保持原有地理方位
- 接 4 条主线

---

## 七、验收（怎么跑、怎么判断）

### 本地必须用 HTTP

```bash
python -m http.server 8899
# → http://localhost:8899/dev.html?mode=2d
```

**为什么**：`file://` 下 `THREE.TextureLoader` 会失败、`canvas.getImageData` 会
报 tainted —— 已实测确认。2D 版用 `<img>` 加载没问题，但 `getImageData` 仍然受限，
所以**验收脚本必须走 HTTP**。

### 2D 验收（24 项）

```bash
node tools/verify-2d.js                                    # 本地
node tools/verify-2d.js https://kurilx.github.io/htmlGame-MusubiNoMachi/game.html  # 线上
```

覆盖：Canvas2D 初始化 / 未建 3D 场景 / 画布有内容 / 瓦片精确裁切 /
角色帧可取 / 移动 / 四方向朝向 / 行走动画 / 碰撞 / 相机跟随 / NPC /
**UI 可见** / **HUD 有数值** / **角色有外观图层** / **合成后头部是头发色**

### 3D 回归（不能破坏）

```bash
node tools/verify-d1.js      # 20/20
node tools/verify-menu.js    # 37/37
node tools/verify-intro.js   # 24/24
node tools/verify-pack.js http://localhost:8899/dev.html   # 19/19
```

改动共享模块（`91-main.js` / `70-ui.js` / `80-save.js`）后**必须**跑这几个。

### 当前基线（HEAD `a68c24d`）

```
verify-2d      24/24   ✅
verify-d1      20/20   ✅
verify-menu    37/37   ✅
verify-intro   24/24   ✅
verify-pack    19/19   ✅
```

---

## 八、踩过的坑（别重复踩）

### 渲染相关

1. **`#boot` 是启动遮罩，`#ui` 是 HUD，别一起隐藏**
   曾经写了 `ui.style.display='none'`，用户反馈「UI 怎么全丢了」。
   2D 模式要隐藏 `#boot`，但**保留 `#ui`**。
   表现为「渲染数据全对、截图却是 loading 页」。

2. **离屏 canvas 与 ctx 要一起判空**
   `resize()` 里重建 canvas 会把 `init()` 建的 ctx 弄丢，
   报 `Cannot read properties of null (reading 'getImageData')`。

3. **逻辑分辨率要跟随窗口**
   固定 640×360 + 整数倍缩放在 1078×596 下 `scale=1`，
   画面只占中间一小块。改成按窗口算（539×298 @ 2×）。

4. **`repeat > 1` 会让整张图集平铺**（3D 时代的老坑）
   2D 用 `drawImage` 裁切不存在这问题，但如果哪天回去用 UV，记得切独立 canvas。

### 素材相关

5. **坐标必须验证，不能猜**
   曾经以为 `row=40,col=5` 是草地，实际是透明装饰块。
   写脚本按「100% 不透明 + 低方差」筛选，再裁出来人工看。

6. **角色图集是裸模**
   `14_human_sprite_base.png` 是光头白身红裤。
   要靠 `55-char-skin.js` 程序化叠外观，不是素材自带。

### 工程相关

7. **等页面就绪一律轮询 `__GAME_READY__`，不要固定 `sleep`**
   本项目 5 个验收脚本曾用 `sleep(4500/5000)`，加入加载页后全部超时，
   表现为「Runtime.evaluate timeout」且脚本无任何输出。

8. **CI 部署要复制 `assets/`**
   曾经只 `cp game.html`，导致线上素材全部 404，
   而"线上能打开、CI 绿、本地绿"完全看不出问题。
   **上线后必须直接请求素材 URL 验证。**

9. **验收脚本必须从 `process.argv[2]` 读 URL 并打印真实地址**
   这个错犯过 3 次（把本地结果当成线上验收）。

10. **批量跑脚本要留间隔**
    本机可用内存常只剩 1.5~2.5 GB，连续启动 8 个 Chrome 会互相挤占。

11. **测线上的 2D 要带 `mode=2d`**
    `verify-2d.js` 里有 `ensure2d()` 自动补，但手写 URL 时别忘。

---

## 九、给接手者的三条建议

1. **先跑一遍验收**，确认基线是 24/24 + 那四个绿，再动手。
   基线不绿说明环境有问题（多半是 HTTP 服务没起或端口被占）。

2. **每批做完先给用户看截图**，不要连续做几批再汇报。
   这个项目历史上"做完直接上线结果方向不对"返工过多次。

3. **改共享模块前先查这个模块有没有 THREE 依赖**
   `44-combat` / `61-quest` / `80-save` / `70-ui` / `72-dialog` 是完全解耦的，
   改它们不会影响 2D；但 `41-enemy` / `45-vfx` 是深度耦合 3D 的，要小心。

---

## 十、快速参考

### 文件地图

```
src/50-canvas2d.js      2D 渲染层
src/51-rpg16-tiles.js   瓦片索引（坐标已验证）
src/52-world2d.js       2D 世界与地图
src/53-boot2d.js        2D 启动器
src/54-hud2d.js         HUD 桥接
src/55-char-skin.js     角色外观合成
src/91-main.js          boot 分流（?mode=2d）
src/70-ui.js            HUD（两条路线共用）
assets/rpg16/           2D 素材（14 文件）
assets/pack/            3D 素材（勿删）

tools/verify-2d.js      2D 验收 24 项
tools/cdp.js            CDP 封装（动态端口）
```

### 常用命令

```bash
# 起服务
python -m http.server 8899

# 构建单文件
node build.mjs

# 2D 验收
node tools/verify-2d.js

# 3D 回归
node tools/verify-d1.js && node tools/verify-menu.js
```

### 关键地址

- 线上 2D：https://kurilx.github.io/htmlGame-MusubiNoMachi/game.html?mode=2d
- 线上 3D：https://kurilx.github.io/htmlGame-MusubiNoMachi/game.html
- 仓库：https://github.com/KurilX/htmlGame-MusubiNoMachi
- 计划工单：#21
- 2D 架构工单：#19

### 素材授权（必须保留署名）

| 素材 | 授权 |
|---|---|
| 16x16 RPG Tileset | CC-BY-SA 3.0 + GPL |
| Town Guards Vol.1（3D 用） | CC0 |
| Exterior 32×32 Town（3D 用） | CC0 / CC-BY-SA |

游戏内「素材来源」面板可查完整署名（主菜单 → 设置）。
