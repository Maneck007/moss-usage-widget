'use strict';
// Claude Pro 订阅用量：通过隐藏的真实浏览器页签打开 claude.ai 官方用量页
// （设置→使用情况），用注入的捕获 preload 钩住页面自身的 fetch/XHR，
// 原样拿到官方用量接口响应。
//
// ★ 为什么这么做：
//   1. claude.ai 有 Cloudflare 人机验证，独立 HTTP 请求必被拦截；
//      真实 Chromium 渲染器可正常通过（遇人工验证会自动弹窗让用户点一下）
//   2. 社区流传的 /api/usage 端点已失效（实测返回 not_found_error）——
//      捕获"页面自己发的请求"不依赖硬编码端点，官方改路径也能自动跟上
//   3. 不用 CDP 调试协议（实测 Network.enable 在隐藏窗口上会永久挂起）
//
// ★ 账号安全设计（大陆用户重点）：
//   - 页签走 Electron 默认网络栈：与 Claude 桌面端同一套系统代理与 TLS 指纹
//   - 不伪造 UA / 不绕过验证 / 无固定轮询：同步跟随本地真实使用事件
//
// 认证：Cookie sessionKey（从已登录 claude.ai 的浏览器复制，形如 sk-ant-sid01-...）

const fs = require('fs');
const path = require('path');
const os = require('os');

const RAW_FILE = path.join(os.homedir(), '.moss-usage-widget', 'claude-usage-raw.json');
const PARTITION = 'persist:moss-claude'; // 持久化，Cloudflare 凭证跨重启复用
const PRELOAD = path.join(__dirname, 'claude-capture-preload.js');

let syncing = false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normWin(w) {
  if (!w || typeof w !== 'object') return null;
  let p = w.utilization ?? w.utilization_percent ?? w.percent_used ?? w.used_percentage;
  if (p == null || typeof p !== 'number') return null;
  if (p > 0 && p <= 1) p = p * 100;
  const reset = w.resets_at ? Date.parse(w.resets_at) : null;
  return { pct: Math.max(0, Math.min(100, p)), reset: Number.isFinite(reset) ? reset : null };
}

// 在任意 JSON 结构里递归寻找"带百分比字段的窗口对象"，返回 [{path, node}]
function findWindows(node, path, out) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((x, i) => findWindows(x, `${path}[${i}]`, out)); return out; }
  const keys = Object.keys(node);
  if (keys.some(k => ['utilization', 'utilization_percent', 'percent_used', 'used_percentage'].includes(k)
    && typeof node[k] === 'number')) {
    out.push({ path: path.toLowerCase(), node });
  }
  for (const k of keys) findWindows(node[k], `${path}.${k}`, out);
  return out;
}

function pickBody(caps) {
  const jsons = caps
    .map(c => ({ url: c.url, body: String(c.body || '') }))
    .filter(c => c.body.trim().startsWith('{') && /utilization|five|seven|resets/i.test(c.body));
  return jsons[0] || null;
}

async function fetchUsageViaPage(cfg, hooks) {
  const { BrowserWindow, session } = require('electron');
  const key = String(cfg.claudeSessionKey || '').trim();
  if (!key || key.length < 20) throw new Error('未配置 claudeSessionKey');
  if (syncing) throw new Error('上一次同步仍在进行');
  syncing = true;
  hooks = hooks || {};
  const status = (m) => { try { hooks.onStatus && hooks.onStatus(m); } catch { } };

  const ses = session.fromPartition(PARTITION);
  await ses.cookies.set({
    url: 'https://claude.ai', name: 'sessionKey', value: key,
    secure: true, httpOnly: true, sameSite: 'lax',
  });

  const win = new BrowserWindow({
    show: false, skipTaskbar: true, minimizable: false, maximizable: false,
    webPreferences: {
      session: ses, backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: false,   // 捕获 preload 需要钩住页面主世界的 fetch/XHR
      sandbox: false,
      preload: PRELOAD,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  console.log('[moss] 用量页签已创建');

  let verifyShown = false;
  try {
    // loadURL 无内建超时：与 40s 定时竞赛
    try {
      await Promise.race([
        win.loadURL('https://claude.ai/settings/usage'),
        sleep(40000),
      ]);
    } catch { /* SPA 加载中断不致命 */ }

    // 等捕获命中（SPA 挂载后才会发用量请求），期间若出现人机验证则弹窗请用户点一下
    const deadline = Date.now() + 60000;
    let hit = null;
    while (Date.now() < deadline) {
      await sleep(1000);
      let caps = [];
      try {
        caps = await win.webContents.executeJavaScript(
          '(window.__mossCaps || []).map(c => ({url: c.url, body: c.body}))', true) || [];
      } catch { /* 页面跳转中 */ }

      const title = await win.webContents.executeJavaScript('document.title', true).catch(() => '');
      if (/just a moment|请稍候/i.test(String(title)) && !verifyShown) {
        verifyShown = true;
        status('请在弹出的验证窗口中完成人机验证（点一下即可）');
        try { win.show(); } catch { }
        console.log('[moss] Cloudflare 需要人工验证，已显示验证窗口');
      }

      hit = pickBody(caps);
      if (hit) break;
    }

    if (verifyShown) {
      try { win.hide(); } catch { }
      status('验证通过，正在同步…');
    }
    if (!hit) {
      // 兜底：把捕获到的原文存下来便于排查
      try {
        const caps = await win.webContents.executeJavaScript(
          '(window.__mossCaps || []).map(c => ({url: c.url, body: c.body}))', true) || [];
        if (caps.length) {
          fs.mkdirSync(path.dirname(RAW_FILE), { recursive: true });
          fs.writeFileSync(RAW_FILE, caps.map(c => c.url + '\n' + c.body).join('\n\n').slice(0, 20000));
        }
      } catch { }
      throw new Error('用量数据未捕获（可能需要人工验证或页面结构变化）');
    }

    try {
      fs.mkdirSync(path.dirname(RAW_FILE), { recursive: true });
      fs.writeFileSync(RAW_FILE, ('[' + hit.url + ']\n' + hit.body).slice(0, 20000));
    } catch { /* 非致命 */ }
    console.log('[moss] 已捕获用量接口:', hit.url);

    const j = JSON.parse(hit.body);
    const found = findWindows(j, '', []);
    let five = null, week = null, weekOpus = null;
    five = found.find(f => /five|5h/.test(f.path)) || null;
    week = found.find(f => /seven|week/.test(f.path)) || null;
    weekOpus = found.find(f => /opus/.test(f.path)) || null;
    if (!five && !week && found.length >= 2) { five = found[0]; week = found[1]; }
    if (!five && !week) throw new Error('响应里没找到用量字段（原始响应已存 claude-usage-raw.json）');

    status('同步完成');
    return {
      at: Date.now(),
      five: five ? normWin(five.node) : null,
      week: week ? normWin(week.node) : null,
      weekOpus: weekOpus ? normWin(weekOpus.node) : null,
    };
  } finally {
    try { win.destroy(); } catch { }
    syncing = false;
  }
}

async function pollUsage(cfg, hooks) {
  return fetchUsageViaPage(cfg, hooks);
}

module.exports = { pollUsage };
