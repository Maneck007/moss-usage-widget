'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_DIR = __dirname;
const RUN_DIR = path.join(os.homedir(), '.moss-usage-widget');
const SNAPSHOT_FILE = path.join(RUN_DIR, 'claude-snapshot.json');
const POS_FILE = path.join(RUN_DIR, 'pos.json');
fs.mkdirSync(RUN_DIR, { recursive: true });

const cfg = loadConfig();

const CARD_W = 360;                 // 卡片宽（窗口贴齐卡片，四周仅 8px 透明边）
// 宠物尺寸随 config.pet.scale 缩放，窗口随之自适应
function petScale() { return Math.max(0.5, Math.min(1.6, Number(cfg.pet && cfg.pet.scale) || 1)); }
function petDims() { const s = petScale(); return { w: Math.round(176 * s), h: Math.round(191 * s) }; }
function dimsFor(v, tab) {
  const pd = petDims();
  if (v === 'pill') return { w: pd.w + 8 + 262 + 22, h: Math.max(292, pd.h + 105) };
  const known = cardHeights[tab || lastTab] || 0; // 实测过的精确高度直接用，避免两段缩放
  return { w: CARD_W, h: known || 740 + pd.h + 14 };
}

const state = {
  bigmodel: { ok: false, level: null, limits: [], at: 0, err: null },
  claude: {
    usage: null,          // 服务端额度 {at, five:{pct,reset}, week:{pct,reset}, weekOpus}
    usageErr: null,
    syncing: false,       // 页签同步进行中（渲染器据此显示"正在同步"）
    snapshot: null, snapshotAt: 0,   // statusLine 快照（备用通道）
    today: { in: 0, out: 0, reqs: 0 },
    days14: [], heat91: [],
    lastActivityAt: 0, topModel: null,
  },
  zcode: {
    today: { in: 0, out: 0, reqs: 0 },
    days14: [], heat91: [],
    lastActivityAt: 0, topModel: null,
  },
};

let win = null;
let tray = null;
let expanded = true;

function loadConfig() {
  const p = path.join(APP_DIR, 'config.json');
  if (!fs.existsSync(p)) fs.copyFileSync(path.join(APP_DIR, 'config.example.json'), p);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function saveConfig() {
  fs.writeFileSync(path.join(APP_DIR, 'config.json'), JSON.stringify(cfg, null, 2));
}

/* ---------- collectors ---------- */
const bigmodel = require('./lib/bigmodel');
const claudeLocal = require('./lib/claude-local');
const zcodeLocal = require('./lib/zcode-local');
const claudeUsage = require('./lib/claude-usage');
const statusline = require('./lib/statusline');
const appWatcher = require('./lib/app-watcher');

async function pollBigmodel() {
  try {
    if (!cfg.bigmodelApiKey) throw new Error('请先在 config.json 配置 bigmodelApiKey');
    const r = await bigmodel.pollQuota(cfg);
    Object.assign(state.bigmodel, r, { err: null, ok: true });
  } catch (e) {
    state.bigmodel.ok = false;
    state.bigmodel.err = String((e && e.message) || e);
    state.bigmodel.at = Date.now();
  }
}

let lastVerifyFailAt = 0;
async function pollClaudeUsage() {
  if (state.claude.syncing) return;
  state.claude.syncing = true;
  try {
    const r = await claudeUsage.pollUsage(cfg, {
      onStatus: (m) => { if (win && win.webContents) win.webContents.send('claude-status', m); },
    });
    state.claude.usage = r;
    state.claude.usageErr = null;
    // 数据无变化 → 自动放宽下次间隔（上限 45 分钟），有变化 → 回到 12~17 分钟
    const h = JSON.stringify([r.five && r.five.pct, r.week && r.week.pct, r.five && r.five.reset, r.week && r.week.reset]);
    if (h === lastUsageHash) usageGapMs = Math.min(45 * 60 * 1000, usageGapMs * 1.5);
    else { lastUsageHash = h; usageGapMs = (12 + Math.random() * 5) * 60 * 1000; }
  } catch (e) {
    const msg = String((e && e.message) || e);
    state.claude.usageErr = msg;
    if (msg.includes('验证') || msg.includes('403')) lastVerifyFailAt = Date.now();
  } finally {
    state.claude.syncing = false;
  }
}
let lastUsageHash = '';
let usageGapMs = (12 + Math.random() * 5) * 60 * 1000;

// 事件驱动同步：不做独立定时轮询。
// 'activity'：跟随 Claude 客户端节奏（会话文件写入 = 刚发生过真实请求，拖尾 60s 后触发）
// 'panel'：用户打开面板（3~8 分钟随机冷却）  'manual'：菜单手动刷新  'startup'：仅 24h 内有过活动
function maybeSyncUsage(reason) {
  if (!cfg.claudeSessionKey || cfg.claudeSessionKey.length < 20) return;
  const now = Date.now();
  if (reason === 'manual') { pollClaudeUsage(); return; }
  if (reason === 'startup') {
    if (state.claude.lastActivityAt && now - state.claude.lastActivityAt < 24 * 3600 * 1000) pollClaudeUsage();
    return;
  }
  const gap = reason === 'panel'
    ? (lastVerifyFailAt && now - lastVerifyFailAt < 10 * 60 * 1000
        ? (60 + Math.random() * 60) * 1000        // 刚通过验证：1~2 分钟内就补一次同步
        : (3 + Math.random() * 5) * 60 * 1000)
    : usageGapMs;
  if (now - lastUsageSyncAt < gap) return;
  lastUsageSyncAt = now;
  pollClaudeUsage();
}
let lastUsageSyncAt = 0;

function scanLocal() {
  try { Object.assign(state.claude, claudeLocal.scan()); } catch { /* 本地统计失败不致命 */ }
  try { Object.assign(state.zcode, zcodeLocal.scan()); } catch { }
}

function readSnapshot() {
  try {
    const st = fs.statSync(SNAPSHOT_FILE);
    if (st.mtimeMs !== state.claude.snapshotAt) {
      state.claude.snapshotAt = st.mtimeMs;
      state.claude.snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    }
  } catch { /* 尚无快照 */ }
}

/* ---------- window ---------- */
function defaultPos(w, h) {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - w - 16, y: wa.y + 40 };
}

function createWindow() {
  const { w, h } = dimsFor(expanded ? 'card' : 'pill', lastTab);
  let x, y;
  try {
    const p = JSON.parse(fs.readFileSync(POS_FILE, 'utf8'));
    x = p.x; y = p.y;
  } catch { ({ x, y } = defaultPos(w, h)); }

  win = new BrowserWindow({
    width: w, height: h, x, y,
    minWidth: 380, minHeight: 260,
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(APP_DIR, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // 主题色要在渲染器就绪后补推一次（否则启动竞态会错过，"跟随系统"初值不对）
  win.webContents.on('did-finish-load', () => {
    pushAccent();
    if (win) {
      win.webContents.send('pet-scale', petScale());
      win.webContents.send('cfg', { pillRotate: cfg.pillRotate !== false, ttsWarning: !!cfg.ttsWarning });
    }
  });

  // 位置记忆
  let moveTimer = null;
  win.on('move', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      try { const [px, py] = win.getPosition(); fs.writeFileSync(POS_FILE, JSON.stringify({ x: px, y: py })); } catch { }
    }, 600);
  });
  win.on('closed', () => { win = null; });
}

function setView(v, tab) {
  expanded = v === 'card';
  if (tab) lastTab = tab;
  if (!win) return;
  const { w, h } = dimsFor(v, tab);
  // 底边对齐：切视图时窗口变矮就下沉、变高就向上长，贴合"插件停靠桌面底部"的习惯
  const [, oldH] = win.getSize();
  const [oldX, oldY] = win.getPosition();
  applySize(w, h);
  const d = screen.getDisplayMatching(win.getBounds());
  const wa = d.workArea;
  let x = oldX, y = oldY + (oldH - h);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  if (x !== oldX || y !== oldY) win.setPosition(x, y);
  if (win.webContents) win.webContents.send('set-view', expanded ? 'card' : 'pill');
}

function resetPos() {
  try { fs.unlinkSync(POS_FILE); } catch { }
  const { w, h } = dimsFor(expanded ? 'card' : 'pill', lastTab);
  if (win) { const { x, y } = defaultPos(w, h); win.setPosition(x, y); }
}

function broadcast() {
  if (win && win.webContents) win.webContents.send('usage', state);
}

// 系统主题色（主题设为"跟随系统"时使用）——模块级函数，createWindow 与 whenReady 都要能用
// 注意：本 Electron 版本 Windows 上要用 getAccentColor()（getColor('accent') 不存在）
function pushAccent() {
  try {
    let c = systemPreferences.getAccentColor();
    // 返回形如 '3F3F3FFF'（无 #、带 alpha）——规范化成 '#RRGGBB'，否则 CSS color-mix 会整条失效
    if (c) {
      c = String(c).replace('#', '');
      if (c.length === 8) c = c.slice(0, 6);
      if (c.length === 3) c = c.split('').map(x => x + x).join('');
      c = /^[0-9a-fA-F]{6}$/.test(c) ? '#' + c.toLowerCase() : null;
    }
    console.log('[moss] 系统 accent:', c);
    if (c && win && win.webContents) win.webContents.send('system-accent', c);
  } catch (e) {
    console.log('[moss] accent 读取失败:', e.message);
  }
}

// 各标签页完整形态的实测窗口高度（渲染器收敛后回报，持久化避免每次启动都两段缩放）
const HEIGHTS_FILE = path.join(RUN_DIR, 'card-heights.json');
let cardHeights = { zcode: 0, claude: 0 };
let lastTab = 'zcode';
try { cardHeights = Object.assign(cardHeights, JSON.parse(fs.readFileSync(HEIGHTS_FILE, 'utf8'))); } catch { }
function saveHeights() {
  try { fs.writeFileSync(HEIGHTS_FILE, JSON.stringify(cardHeights)); } catch { }
}

function setPetScale(s) {
  cfg.pet = cfg.pet || {};
  cfg.pet.scale = s;
  saveConfig();
  if (win && win.webContents) win.webContents.send('pet-scale', s);
  setView(expanded ? 'card' : 'pill'); // 重新按新尺寸收敛窗口
}

// Windows 坑：resizable:false 的窗口 setSize 会被静默拒绝，临时开一下再关
function applySize(w, h) {
  if (!win) return;
  const wasResizable = win.isResizable();
  if (!wasResizable) win.setResizable(true);
  win.setSize(w, h);
  if (!wasResizable) win.setResizable(false);
}

/* ---------- ipc ---------- */
ipcMain.on('passthrough', (e, flag) => {
  if (win) win.setIgnoreMouseEvents(!!flag, { forward: true });
});
ipcMain.on('drag-by', (e, dx, dy) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});
ipcMain.on('set-view', (e, payload) => {
  const { v, tab } = payload || {};
  setView(v, tab);
});
ipcMain.on('tab-changed', (_e, tab) => { lastTab = tab; });
ipcMain.on('report-card-height', (_e, tab, h) => {
  const n = Number(h) || 0;
  if (!tab || n < 400) return;
  if (Math.abs((cardHeights[tab] || 0) - n) > 2) {
    cardHeights[tab] = n;
    saveHeights();
  }
});
ipcMain.on('reset-pos', () => resetPos());
ipcMain.on('claude-sync-hint', () => maybeSyncUsage('panel'));
ipcMain.on('fit-height', (_e, delta) => {
  if (!win || !expanded) return;
  const d = Number(delta) || 0;
  const { w } = dimsFor('card');
  const [, oldH] = win.getSize();
  const [oldX, oldY] = win.getPosition();
  const nh = Math.max(560, Math.min(1400, oldH + d));
  applySize(w, nh);
  // 高度变化时底边保持不动（向下长不出去就向上长）
  const disp = screen.getDisplayMatching(win.getBounds());
  const wa = disp.workArea;
  let y = oldY + (oldH - nh);
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - nh));
  win.setPosition(oldX, y);
});
ipcMain.on('context-menu', () => {
  Menu.buildFromTemplate([
    { label: expanded ? '切换到药丸模式' : '切换到完整面板', click: () => setView(expanded ? 'pill' : 'card') },
    { label: '立即刷新', click: () => { pollBigmodel(); maybeSyncUsage('manual'); scanLocal(); } },
    {
      label: '宠物大小',
      submenu: [
        { label: '小', type: 'radio', checked: petScale() < 0.95, click: () => setPetScale(0.7) },
        { label: '中', type: 'radio', checked: petScale() >= 0.95 && petScale() <= 1.05, click: () => setPetScale(1.0) },
        { label: '大', type: 'radio', checked: petScale() > 1.05, click: () => setPetScale(1.3) },
      ],
    },
    { type: 'separator' },
    { label: `随 ZCode/Claude 自动启动：${cfg.followApps ? '开' : '关'}`, click: () => { cfg.followApps = !cfg.followApps; appWatcher.apply(cfg.followApps, APP_DIR, cfg.watchProcesses); saveConfig(); } },
    { label: '编辑配置文件', click: () => require('child_process').exec(`notepad "${path.join(APP_DIR, 'config.json')}"`) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]).popup();
});

/* ---------- app lifecycle ---------- */
const gotLock = process.env.MOSS_NOLOCK === '1' || app.requestSingleInstanceLock(); // MOSS_NOLOCK: 调试双开
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); setView('card'); } });

  app.whenReady().then(() => {
    createWindow();

    if (cfg.installStatusline) {
      try { statusline.install(APP_DIR); } catch (e) { console.error('statusline 安装失败:', e.message); }
    }
    if (cfg.followApps) appWatcher.apply(true, APP_DIR, cfg.watchProcesses);

    pollBigmodel(); scanLocal(); readSnapshot(); maybeSyncUsage('startup');
    setInterval(pollBigmodel, Math.max(30, cfg.pollSec.bigmodel || 60) * 1000);

    // 监听 Claude 会话文件写入：客户端每完成一轮请求必然追加一次 jsonl，
    // 这是最贴近"刚发生过真实请求"的本地信号。拖尾 60s 静默后触发一次同步判定。
    let actTimer = null;
    try {
      fs.watch(path.join(os.homedir(), '.claude', 'projects'), { recursive: true }, (evt, file) => {
        if (!file || !String(file).endsWith('.jsonl')) return;
        state.claude.lastActivityAt = Date.now(); // 实时活跃信号（MOSS 工作态也吃这个）
        clearTimeout(actTimer);
        actTimer = setTimeout(() => maybeSyncUsage('activity'), 60 * 1000);
      });
      console.log('[moss] 已监听 Claude 会话活动，用量将跟随真实请求节奏同步（无活动零查询）');
    } catch (e) {
      console.log('[moss] 文件监听不可用，仅手动/开面板时同步：', e.message);
    }

    // 出口方式透明化：claude.ai 请求与桌面端同走 Chromium 栈（系统代理/PAC）
    try {
      require('electron').session.defaultSession.resolveProxy('https://claude.ai').then(p => {
        console.log('[moss] claude.ai 出口方式:', p);
        if (String(p).trim().toUpperCase() === 'DIRECT') {
          console.log('[moss] 注意：未检测到系统代理，Claude 额度请求将直连。受限地区用户请用系统代理/TUN 模式，或留空 claudeSessionKey（本地统计不受影响）。');
        }
      });
    } catch { }

    // 系统主题色变化监听（主题设为"跟随系统"时使用；初始推送见 did-finish-load）
    try { systemPreferences.on('accent-color-changed', () => pushAccent()); } catch { }

    setInterval(scanLocal, Math.max(10, cfg.pollSec.local || 30) * 1000);
    setInterval(readSnapshot, 5000);
    setInterval(broadcast, 1000);

    try { globalShortcut.register('Control+Alt+M', () => setView(expanded ? 'pill' : 'card')); } catch { }

    try {
      tray = new Tray(path.join(APP_DIR, 'assets', 'tray.png'));
      tray.setToolTip('MOSS 用量监视器');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '展开 / 收起', click: () => setView(expanded ? 'pill' : 'card') },
        { label: '退出', click: () => app.quit() },
      ]));
      tray.on('click', () => setView(expanded ? 'pill' : 'card'));
    } catch (e) { console.error('托盘初始化失败:', e.message); }

    // 调试截图模式：MOSS_CAPTURE=目录
    //   MOSS_FRAMES=1 → 抓宠物 8 帧（350ms 间隔）用于动画差分检测
    //   默认          → 抓 卡片-ZCode / 卡片-Claude / 药丸 三张视图
    const capDir = process.env.MOSS_CAPTURE;
    if (capDir) {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // 渲染器 console 与 CSP 违规都转出来，便于排查
      win.webContents.on('console-message', (e, level, msg, line, src) => {
        if (level >= 1) console.log('[renderer]', msg, `(${src}:${line})`);
      });
      if (process.env.MOSS_DUMP) {
        setView('card');
        setTimeout(async () => {
          try {
            const info = await win.webContents.executeJavaScript(`(() => {
              const m = (sel) => { const el = document.querySelector(sel); if (!el) return null; return { sh: el.scrollHeight, ch: el.clientHeight }; };
              const sw = document.querySelectorAll('.swatch');
              return JSON.stringify({
                viewZcode: m('#view-zcode'),
                viewClaude: m('#view-claude'),
                cardRect: (() => { const c = document.getElementById('card'); const r = c.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; })(),
                swatchCount: sw.length,
              });
            })()`, true);
            console.log('[dump]', info);
          } catch (e) { console.error('dump fail', e); }
          app.quit();
        }, 6000);
        return;
      }
      setTimeout(async () => {
        try {
          if (process.env.MOSS_FRAMES) {
            setView('pill'); await sleep(900);
            for (let i = 0; i < 8; i++) {
              const img = await win.webContents.capturePage();
              fs.writeFileSync(path.join(capDir, `frame${i}.png`), img.toPNG());
              await sleep(350);
            }
          } else {
            setView('card'); await sleep(5600); // 等 4.2s 气泡退场
            try {
              const m = await win.webContents.executeJavaScript(`(() => {
              const mm = (sel) => { const el = document.querySelector(sel); return el ? el.scrollHeight + '/' + el.clientHeight : 'null'; };
              return 'body=' + document.body.className + ' win=' + innerWidth + 'x' + innerHeight + ' viewZ=' + mm('#view-zcode') + ' viewK=' + mm('#view-claude');
              })()`, true);
              console.log('[moss] 高度测量(内容/可视):', m);
            } catch { }
            // 模拟点击"明细"，验证浮层弹出
            try { await win.webContents.executeJavaScript('document.getElementById("btnDetail").click()', true); await sleep(600); } catch { }
            let img = await win.webContents.capturePage();
            fs.writeFileSync(path.join(capDir, 'card-zcode.png'), img.toPNG());
            win.webContents.send('debug-tab', 'claude'); await sleep(500);
            img = await win.webContents.capturePage();
            fs.writeFileSync(path.join(capDir, 'card-claude.png'), img.toPNG());
            win.webContents.send('debug-tab', 'zcode'); await sleep(300);
            setView('pill'); await sleep(800);
            img = await win.webContents.capturePage();
            fs.writeFileSync(path.join(capDir, 'pill.png'), img.toPNG());
          }
        } catch (e) { console.error('capture fail', e); }
        app.quit();
      }, 3500);
    }
  });

  app.on('window-all-closed', () => app.quit());
}
