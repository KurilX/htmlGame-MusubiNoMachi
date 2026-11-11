// build.mjs — 把 dev.html 的多文件结构打成单个 game.html
//
// 目标（项目最核心的承诺）：
//   双击 game.html 就能玩，零网络、零 CDN、零外部资源。
//
// 做法：
//   1) 读 dev.html，按出现顺序抽出所有 <script src="src/*.js">
//   2) 读 vendor/three.min.js
//   3) 全部内联成 <script> 字面量，替换掉原标签
//   4) 写 game.html
//
// 注意：
//  - 必须保持脚本的原始顺序（模块间有依赖，见 dev.html 里的注释）
//  - three.min.js 是 UMD，内联后仍是全局 THREE，不需要 module 包装
//  - 内联时要防止脚本内容里出现 </script> 提前闭合，需要转义

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEV = resolve(ROOT, 'dev.html');
const OUT = resolve(ROOT, 'game.html');
const VENDOR = resolve(ROOT, 'vendor/three.min.js');

function die(msg) {
  console.error('构建失败: ' + msg);
  process.exit(1);
}

if (!existsSync(DEV)) die('找不到 dev.html');
if (!existsSync(VENDOR)) die('找不到 vendor/three.min.js（请先固化 three.js）');

let html = readFileSync(DEV, 'utf8');
const threeSrc = readFileSync(VENDOR, 'utf8');

// 内联脚本时，若代码里出现 </script> 会提前闭合标签，必须处理
function safeInline(code) {
  return code.replace(/<\/script>/gi, '<\\/script>');
}

// ---- 1) 抽出所有 <script src="..."> ----
const scriptRe = /<script\s+src="([^"]+)"\s*><\/script>/g;
const collected = [];
let m;
const order = [];

while ((m = scriptRe.exec(html)) !== null) {
  order.push({ tag: m[0], src: m[1] });
}

if (order.length === 0) die('dev.html 里没有找到任何 <script src>');

// ---- 2) 逐个读取，按顺序拼成内联块 ----
const inlined = [];
let totalSrcBytes = 0;

for (const entry of order) {
  const rel = entry.src.replace(/^\.\//, '');
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) die(`引用的脚本不存在: ${rel}`);

  const code = readFileSync(abs, 'utf8');
  totalSrcBytes += Buffer.byteLength(code);

  // vendor/three.min.js 直接内联（它本身无外部依赖）
  inlined.push(
    `<!-- ==== ${rel} ==== -->\n` +
    `<script>\n${safeInline(code)}\n</script>`
  );
}

// ---- 3) 用内联块替换原来的标签（保持原位置） ----
// 做法：按顺序把每个 <script src> 标签替换为对应的内联块
let i = 0;
html = html.replace(scriptRe, () => inlined[i++]);

// ---- 4) 收尾：标注构建信息 + 移除开发期注释 ----
const buildTime = new Date().toISOString();
html = html.replace('</head>',
  `<!-- 构建产物：${buildTime} | 单文件、零外部依赖 | 双击即可运行 -->\n</head>`);

// ---- 5) 写文件 ----
writeFileSync(OUT, html, 'utf8');

// ---- 6) 自检 ----
const outSize = statSync(OUT).size;
const problems = [];

// 6a. 不能再有任何外部 src
const remainingSrc = html.match(/<script\s+src=/g);
if (remainingSrc) problems.push(`残留 ${remainingSrc.length} 个外部 <script src>`);

// 6b. 不能有任何 http(s) 资源引用（除了注释里的说明文字）
const httpRefs = html.match(/(?:src|href)="https?:\/\//g);
if (httpRefs) problems.push(`残留 ${httpRefs.length} 个 http(s) 资源引用`);

// 6c. 不能有 <link rel="stylesheet" href="...">
if (/<link[^>]+href="(?!data:)/i.test(html)) problems.push('存在外部样式表引用');

// 6d. 必须包含 THREE 与游戏入口
if (!html.includes('REVISION')) problems.push('未内联 three.js（找不到 REVISION）');
if (!html.includes('window.G = window.G || {}')) problems.push('未内联游戏模块');

console.log('=== 构建完成 ===');
console.log('输出: game.html');
console.log(`体积: ${(outSize / 1024 / 1024).toFixed(2)} MB (${outSize} 字节)`);
console.log(`内联脚本: ${order.length} 个，源码合计 ${(totalSrcBytes / 1024).toFixed(0)} KB`);

if (problems.length) {
  console.error('\n自检未通过：');
  problems.forEach(p => console.error('  ✗ ' + p));
  process.exit(1);
} else {
  console.log('自检通过：无外部脚本、无 http 引用、无外部样式表');
}
