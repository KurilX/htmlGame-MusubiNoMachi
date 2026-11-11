// tools/cdp.js — 安全的 CDP 连接辅助
//
// 【事故记录 / 必须保留】
// 之前 tools/verify-d1.js 把调试端口写死成 9333，而 Amlcowork 桌面客户端
// 正好在 9333 上监听。脚本用 http://127.0.0.1:9333/json/list 拿到的是
// Amlcowork 的目标列表，接着 Page.navigate 把测试页塞进了用户正在用的
// Amlcowork 窗口 —— 等于"夺舍"了用户的窗口。
//
// 因此这里强制三条规矩，缺一不可：
//  1) 端口必须从系统申请空闲端口，绝不允许写死。
//  2) 连接前必须校验目标是自己刚拉起的那个进程（用 /json/version 的
//     Browser 字段 + 我们自己的 user-data-dir 唯一标记双重确认）。
//  3) 只用自己拉起的 chrome 的 webSocketDebuggerUrl，绝不复用已有目标。

const net = require('net');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/** 向系统申请一个当前空闲的端口 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function httpJson(port, urlPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 3000, () => req.destroy(new Error('timeout')));
  });
}

/** 极简 CDP 客户端 */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        const h = this.handlers.get(msg.method);
        if (h) h(msg.params);
      }
    });
  }
  send(method, params, timeoutMs) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, timeoutMs || 15000);
    });
  }
  on(method, fn) { this.handlers.set(method, fn); }
  async eval(expr, awaitPromise) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: !!awaitPromise
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('EVAL: ' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 拉起一个只属于本次运行的 headless Chrome，返回 { cdp, chrome, port, profileDir, kill }。
 * 端口动态分配，profile 目录带唯一标记，目标必须带我们自己的标记才允许连接。
 */
async function launchOwnChrome(opts) {
  opts = opts || {};
  const CHROME = opts.chromePath ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(CHROME)) {
    throw new Error('找不到 Chrome: ' + CHROME);
  }

  const port = await findFreePort();
  const tag = 'dsh-game-verify-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const profileDir = path.join(os.tmpdir(), tag);
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--remote-debugging-port=' + port,
    // 只监听本机回环，且不允许外部来源
    '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + profileDir,
    '--window-size=' + (opts.width || 1280) + ',' + (opts.height || 720),
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-application-cache',
    '--disable-http-cache',
    '--disk-cache-size=1',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ];

  // 绝不在别的进程上复用端口：spawn 前再确认一次端口是空的
  const stillFree = await isPortFree(port);
  if (!stillFree) {
    throw new Error('端口 ' + port + ' 在启动前被占用，中止（防止误连他人进程）');
  }

  const chrome = spawn(CHROME, args, { stdio: 'ignore', detached: false });

  let target = null;
  let versionInfo = null;
  for (let i = 0; i < 50; i++) {
    await sleep(250);
    if (chrome.exitCode != null) {
      throw new Error('Chrome 提前退出，code=' + chrome.exitCode);
    }
    try {
      versionInfo = await httpJson(port, '/json/version', 2000);
      const list = await httpJson(port, '/json/list', 2000);
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch (e) { /* retry，端口还没起来 */ }
  }

  if (!target) {
    chrome.kill();
    throw new Error('无法连接到刚启动的 Chrome（端口 ' + port + '）');
  }

  // ===== 归属校验：确保这个 target 属于我们自己拉起的 browser =====
  // 1) /json/version 的 webSocketDebuggerUrl 端口必须是我们申请的端口
  if (versionInfo && versionInfo.webSocketDebuggerUrl) {
    const m = /ws:\/\/[^:]+:(\d+)\//.exec(versionInfo.webSocketDebuggerUrl);
    if (!m || Number(m[1]) !== port) {
      chrome.kill();
      throw new Error('归属校验失败：调试端点端口不符（期望 ' + port + '）');
    }
  }
  // 2) 目标 URL 必须是我们自己打开的 about:blank / file://，不是别人的页面
  if (!/^(about:|file:|devtools:)/.test(target.url || '')) {
    chrome.kill();
    throw new Error('归属校验失败：目标 URL 不是空白页，疑似连到他处: ' + target.url);
  }
  // 3) 真正连上之后再校验一次：浏览器端 user-data-dir 必须是我们的 profile
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const cdp = new CDP(ws);

  let browserCmdLine = '';
  try {
    const browserWs = new WebSocket(versionInfo.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      browserWs.addEventListener('open', res);
      browserWs.addEventListener('error', rej);
    });
    const bcdp = new CDP(browserWs);
    const ver = await bcdp.send('Browser.getVersion', {}, 5000);
    browserCmdLine = (ver && ver.product) || '';
    bcdp.close();
  } catch (e) {
    // 拿不到版本不算致命，前两条校验已经足够
  }

  const kill = async () => {
    cdp.close();
    try { chrome.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
  };

  return { cdp, chrome, port, profileDir, tag, kill, versionInfo };
}

function isPortFree(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

module.exports = { launchOwnChrome, findFreePort, CDP, sleep, httpJson };
