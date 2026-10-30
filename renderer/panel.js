'use strict';
// 渲染与交互：双视图（卡片/药丸）、ZCode/Claude 标签、主题（面板配色）、宠物状态机
// 设计语言移植自参考项目 claude-usage-widget（阈值色阶 / 大环 / 玻璃板 / 周分列热力图）
// 主题语义：配色按钮改的是面板颜色（默认跟随系统 accent）；额度环颜色恒定按百分比自适应

/* ---------- 常量 ---------- */
const RING_C = 2 * Math.PI * 32; // r=32

// 热力图时间范围三档（数据扫描窗口 145 天，全部覆盖）
const HEAT_RANGES = [
  { id: 'short', days: 35, label: '35 天' },
  { id: 'mid', days: 91, label: '91 天' },
  { id: 'long', days: 140, label: '140 天' },
];

// 状态色阶（额度环/进度条专用，与主题无关，保证"颜色=健康度"的直觉）
const R_NORMAL = { a1: '#5EE39A', a2: '#22C55E', rgb: '34,197,94' };
const R_WARN   = { a1: '#FFD060', a2: '#FF9F0A', rgb: '255,159,10' };
const R_CRIT   = { a1: '#FF8A80', a2: '#FF453A', rgb: '255,69,58' };
const rampFor = (pct) => (pct >= 85 ? R_CRIT : pct >= 60 ? R_WARN : R_NORMAL);

// 面板配色（accent：面板玻璃染色/柱状图/圆点/底栏）
const PALETTES = [
  { id: 'auto',   label: '跟随系统' },
  { id: 'mint',   label: '薄荷',   ac: '#30D158' },
  { id: 'coral',  label: '珊瑚',   ac: '#D97757' },
  { id: 'blue',   label: '蔚蓝',   ac: '#0A84FF' },
  { id: 'purple', label: '紫罗兰', ac: '#BF5AF2' },
  { id: 'mono',   label: '石墨',   ac: '#8E8E93' },
];

const $ = (sel) => document.querySelector(sel);
const pref = {
  get: (k, d) => { try { const v = localStorage.getItem('moss.' + k); return v == null ? d : v; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('moss.' + k, v); } catch { } },
};

/* ---------- 小工具 ---------- */
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 8) h = h.slice(0, 6);        // #RRGGBBAA（Windows accent 带透明度）
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function mixHex(a, b, w) { // w = a 的占比
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = (x, y) => Math.round(x * w + y * (1 - w));
  return '#' + [c(A.r, B.r), c(A.g, B.g), c(A.b, B.b)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function fmtTok(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function fmtAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  return Math.floor(s / 86400) + ' 天前';
}
function normTime(t) {
  if (t == null) return null;
  if (typeof t === 'string') { const d = Date.parse(t); return Number.isFinite(d) ? d : null; }
  if (typeof t === 'number') return t > 1e12 ? t : t * 1000;
  return null;
}
function fmtReset(t) {
  const ms = normTime(t);
  if (ms == null) return '';
  const d = ms - Date.now();
  if (d <= 0) return '待重置';
  const m = Math.floor(d / 60000);
  if (m < 1) return '<1 分钟后重置';
  if (m < 60) return m + ' 分钟后重置';
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时${m % 60}分后重置`;
  return `${Math.floor(h / 24)}天${h % 24}时后重置`;
}

/* ---------- 主题（面板配色） ---------- */
let sysAccent = null;
function normHex(x) {
  if (!x) return null;
  let h = String(x).replace('#', '');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(h) ? '#' + h.toLowerCase() : null;
}
function applyTheme(id) {
  const raw = id === 'auto' ? sysAccent : (PALETTES.find(x => x.id === id) || {}).ac;
  const ac = normHex(raw) || '#30D158'; // 任何非法值都兜底，避免 color-mix 整条失效变透明面板
  const { r: R, g: G, b: B } = hexToRgb(ac);
  const r = document.documentElement.style;
  r.setProperty('--ac', ac);
  r.setProperty('--glow', `${R},${G},${B}`);
  r.setProperty('--a1', mixHex(ac, '#ffffff', 0.35));
  r.setProperty('--a2', ac);
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.id === id));
}
function buildThemes() {
  const box = $('#themes');
  box.innerHTML = PALETTES.map(p => {
    const bg = p.ac ? `background:linear-gradient(135deg,${mixHex(p.ac, '#ffffff', 0.35)},${p.ac})` : '';
    const cls = p.id === 'auto' ? 'swatch swatch-auto' : 'swatch';
    return `<span class="${cls}" data-id="${p.id}" title="${p.label}" style="${bg}"></span>`;
  }).join('');
  box.querySelectorAll('.swatch').forEach(s => s.addEventListener('click', () => {
    pref.set('theme', s.dataset.id);
    applyTheme(s.dataset.id);
  }));
}

/* ---------- 环形图（状态色阶，与主题无关） ---------- */
function setRing(progId, pct, tip) {
  const prog = document.getElementById(progId);
  const val = document.getElementById(progId.replace('prog', 'val'));
  if (!prog) return;
  const wrap = prog.closest('.ringWrap');
  if (wrap) wrap.title = tip || '';
  const gradId = prog.getAttribute('stroke').slice(5, -1);
  const stopEls = document.querySelectorAll(`#${gradId} stop`);
  if (pct == null) {
    prog.style.strokeDashoffset = RING_C;
    prog.style.filter = '';
    if (val) val.innerHTML = '<span style="opacity:0.25;font-size:19px">—</span>';
    stopEls.forEach((s, i) => s.setAttribute('stop-color', i === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)'));
    return;
  }
  const v = Math.max(0, Math.min(100, pct));
  const ramp = rampFor(v);
  prog.style.strokeDashoffset = (RING_C * (1 - v / 100)).toFixed(1);
  prog.style.filter = `drop-shadow(0 0 5px rgba(${ramp.rgb},0.5))`;
  stopEls.forEach((s, i) => s.setAttribute('stop-color', i === 0 ? ramp.a1 : ramp.a2));
  if (val) val.innerHTML = `${Math.round(v)}<i>%</i>`;
}

/* ---------- 气泡：卡片模式走面板内通知条，药丸模式走 MOSS 头顶气泡 ---------- */
let bubbleTimer = null;
function say(text, ms = 4200) {
  const t = $('#toast'), b = $('#bubble');
  if (t) { t.textContent = text; t.classList.add('show'); }
  if (b) { b.textContent = text; b.classList.add('show'); }
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (t) t.classList.remove('show');
    if (b) b.classList.remove('show');
  }, ms);
}

/* ---------- 数据视图 ---------- */
let latest = null;
let curTab = pref.get('tab', 'zcode');
let prevMaxPct = 0;
let heatRangeId = pref.get('heatRange', 'mid');
let rotatePill = true;
let ttsOn = false;

function speakTTS(text) {
  if (!ttsOn) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.95;
    u.pitch = 0.6; // 低音 = MOSS 味
    speechSynthesis.speak(u);
  } catch { /* TTS 不可用不致命 */ }
}

function zLimits() { return (latest && latest.bigmodel.limits) || []; }

function claudeWindows() {
  if (latest && latest.claude.usage) {
    const u = latest.claude.usage;
    return { five: u.five, week: u.week, src: 'server' };
  }
  const snap = latest && latest.claude.snapshot;
  const rl = snap && (snap.rate_limits || snap.rateLimits);
  if (rl) {
    const pick = (o) => {
      if (!o) return null;
      let p = o.used_percentage ?? o.percent_used ?? o.utilization ?? o.used_percent;
      if (typeof p === 'number' && p > 0 && p <= 1) p *= 100;
      return typeof p === 'number' ? { pct: p, reset: normTime(o.resets_at) } : null;
    };
    const five = pick(rl.five_hour), week = pick(rl.seven_day);
    if (five || week) return { five, week, src: 'snapshot' };
  }
  return null;
}

function setMeter(prefix, win, label) {
  $('#' + prefix + 'k').textContent = label;
  const v = $('#' + prefix + 'v'), f = $('#' + prefix + 'f');
  const ramp = win ? rampFor(win.pct) : null;
  v.textContent = win ? Math.round(win.pct) + '%' : '—';
  v.style.color = ramp && win.pct >= 60 ? ramp.a2 : '';
  f.style.width = (win ? Math.max(0, Math.min(100, win.pct)) : 0) + '%';
  f.style.background = ramp ? `linear-gradient(90deg,${ramp.a1},${ramp.a2})` : 'rgba(255,255,255,0.10)';
  f.style.boxShadow = ramp && win ? `0 0 6px rgba(${ramp.rgb},0.55)` : 'none';
}

/* 图表渲染（Claude / ZCode 两个标签页共用） */
function renderBars(barsSel, days) {
  const maxDay = Math.max(1, ...days.map(d => d.in + d.out));
  $(barsSel).innerHTML = days.map((d, i) => {
    const total = d.in + d.out;
    const h = total > 0 ? Math.max(6, 100 * total / maxDay) : 5;
    const cls = 'bar' + (total <= 0 ? ' zero' : '') + (i === days.length - 1 ? ' today' : '');
    const tip = `${d.d}: ${fmtTok(total)}${d.cost ? ' / $' + d.cost.toFixed(2) : ''}`;
    return `<span class="barSlot"><span class="${cls}" style="height:${h}%" title="${tip}"></span></span>`;
  }).join('');
}
function renderHeat(monthsSel, gridSel, heat, days) {
  heat = (heat || []).slice(-days);
  const weeksShown = Math.max(1, Math.round(days / 7));
  const nz = heat.map(d => d.total).filter(v => v > 0).sort((a, b) => a - b);
  const q = p => (nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * p))] : 0);
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const levelOf = c => (c <= 0 ? 0 : c <= cuts[0] ? 1 : c <= cuts[1] ? 2 : c <= cuts[2] ? 3 : 4);
  const cols = [];
  let curCol = [];
  heat.forEach((d, i) => {
    const wd = new Date(d.d + 'T12:00:00').getDay();
    if (i === 0) for (let p = 0; p < wd; p++) curCol.push(null);
    curCol.push(d);
    if (wd === 6) { cols.push(curCol); curCol = []; }
  });
  if (curCol.length) { while (curCol.length < 7) curCol.push(null); cols.push(curCol); }
  const weeks = cols.slice(-weeksShown);
  // 格子尺寸自适应列数：短档 18px 上限，长档自动变密保证放下（板内可用宽约 288px）
  const cellW = Math.max(8, Math.min(18, Math.floor((288 - (weeks.length - 1) * 4) / weeks.length)));
  const tpl = `repeat(${weeks.length}, ${cellW}px)`;
  const gm = $(monthsSel), gg = $(gridSel);
  gm.style.gridTemplateColumns = tpl;
  gg.style.gridTemplateColumns = tpl;
  let lastMonth = -1;
  const months = weeks.map(w => {
    const first = w.find(c => c);
    if (!first) return '';
    const m = Number(first.d.slice(5, 7));
    if (m !== lastMonth) { lastMonth = m; return m + '月'; }
    return '';
  });
  gm.innerHTML = months.map(m => `<span class="heatMonth">${m}</span>`).join('');
  gg.innerHTML = weeks.map(w =>
    `<div class="heatCol">${w.map(c => c
      ? `<div class="cell l${levelOf(c.total)}" title="${c.d}: ${fmtTok(c.total)}"></div>`
      : '<div class="cell pad"></div>').join('')}</div>`
  ).join('');
}
function setStats() { /* 已由底部统计直设替代 */ }

/* ---------- 渲染 ---------- */
function render() {
  if (!latest) return;
  const now = Date.now();
  const z = latest.bigmodel;
  const k = latest.claude;

  /* ZCode */
  const limits = zLimits();
  const zMeta = [
    { label: (limits[0] && limits[0].unit === 6) ? '周额度' : '5 小时窗口', l: limits[0] },
    { label: '周额度', l: limits[1] },
  ];
  zMeta.forEach((m, i) => {
    const n = i + 1;
    $('#z' + n + 'label').textContent = m.label;
    if (m.l) {
      setRing('z' + n + 'prog', m.l.percentage, `已用 ${m.l.used} / ${m.l.total} · 剩余 ${m.l.remaining}`);
      $('#z' + n + 'sub').textContent = fmtReset(m.l.nextResetTime);
    } else {
      setRing('z' + n + 'prog', null);
      $('#z' + n + 'sub').textContent = '';
    }
  });
  $('#zLevel').textContent = z.level ? 'Coding Plan ' + z.level[0].toUpperCase() + z.level.slice(1) : '';
  $('#planTag').textContent = curTab === 'zcode'
    ? (z.level ? z.level[0].toUpperCase() + z.level.slice(1) : '')
    : 'Pro';
  $('#zRows').innerHTML = limits.map(l => {
    const units = { 3: '小时' };
    const name = l.unit === 6 ? '周额度' : (units[l.unit] ? `${l.number}${units[l.unit]}窗口` : (l.type || '窗口'));
    return `<div class="quotaRow"><div class="qline"><span class="qk">${name}</span><span class="qv">${l.used ?? '—'} / ${l.total ?? '—'}</span></div><div class="qsub">剩余 ${l.remaining ?? '—'} · ${fmtReset(l.nextResetTime) || '—'}</div></div>`;
  }).join('') || '<div class="quotaRow"><div class="qline"><span class="qk">—</span></div><div class="qsub">暂无数据</div></div>';

  /* Claude */
  const cw = claudeWindows();
  [['k1', cw && cw.five], ['k2', cw && cw.week]].forEach(([id, w]) => {
    if (w) {
      setRing(id + 'prog', w.pct, `已用 ${Math.round(w.pct)}% · ${fmtReset(w.reset)}`);
      $('#' + id + 'sub').textContent = fmtReset(w.reset) || ' ';
    } else {
      setRing(id + 'prog', null);
      $('#' + id + 'sub').textContent = '';
    }
  });
  if (!cw) {
    const e = k.usageErr ? String(k.usageErr) : '';
    if (k.syncing) {
      $('#k1sub').textContent = '正在同步…（如弹出验证窗口请点击）';
      $('#k2sub').textContent = '';
    } else {
      $('#k1sub').textContent =
        !e || e.includes('未配置') ? '待配置 sessionKey'
          : e.includes('验证') || e.includes('403') ? '需人工验证，点托盘"立即刷新"'
            : e.includes('401') ? 'sessionKey 已失效'
              : e.includes('ERR_') || e.includes('超时') ? '网络超时，稍后自动重试'
                : e.slice(0, 24);
      $('#k2sub').textContent = '配置方法见 README';
    }
  }

  /* 近 14 天（costUSD 官方成本可用的就用美元展示） */
  const days = (k.days14 || []);
  renderBars('#bars', days);
  const cost14 = days.reduce((s, d) => s + (d.cost || 0), 0);
  const tok14 = days.reduce((s, d) => s + d.in + d.out, 0);
  $('#c14sum').textContent = fmtTok(tok14);
  $('#c14sum').title = cost14 > 0 ? `≈$${cost14.toFixed(2)} · 近 14 天` : '近 14 天: ' + fmtTok(tok14);

  /* 热力图：周分列（周日在顶），四分位定级，月份标签，范围三档可点切换 */
  const zl = latest.zcode || { today: { in: 0, out: 0, reqs: 0 }, days14: [], heat: [] };
  const range = HEAT_RANGES.find(r => r.id === heatRangeId) || HEAT_RANGES[1];
  $('#kheatDays').textContent = range.label;
  $('#zheatDays').textContent = range.label;
  renderHeat('#heatMonths', '#heatGrid', k.heat, range.days);
  renderHeat('#zheatMonths', '#zheatGrid', zl.heat, range.days);

  /* 底部统计：花费(官方 costUSD 累计近似) / token / 主力模型 */
  $('#statCost').textContent = '≈$' + (k.today.cost || 0).toFixed(2);
  $('#statCost').title = '按会话记录 costUSD 累计值近似';
  $('#statTok').textContent = fmtTok(k.today.in + k.today.out);
  $('#statTok').title = `输入 ${fmtTok(k.today.in)} · 输出 ${fmtTok(k.today.out)}`;
  $('#statModel').textContent = k.topModel ? k.topModel.name : '—';
  $('#statModel').title = k.topModel ? k.topModel.name : '';
  $('#statShare').textContent = k.topModel ? Math.round(k.topModel.share * 100) + '% 占比' : '暂无会话';

  /* ZCode 本地统计（补齐标签页，来自 ~/.zcode/cli/rollout 推理日志；无官方成本字段，展示 token/次数） */
  renderBars('#zbars', zl.days14 || []);
  $('#zc14sum').textContent = fmtTok((zl.days14 || []).reduce((s, d) => s + d.in + d.out, 0));
  $('#zstatTok').textContent = fmtTok(zl.today.in + zl.today.out);
  $('#zstatTok').title = `输入 ${fmtTok(zl.today.in)} · 输出 ${fmtTok(zl.today.out)}`;
  $('#zstatReq').textContent = String(zl.today.reqs);
  $('#zstatModel').textContent = zl.topModel ? zl.topModel.name : '—';
  $('#zstatModel').title = zl.topModel ? zl.topModel.name : '';
  $('#zstatShare').textContent = zl.topModel ? Math.round(zl.topModel.share * 100) + '% 占比' : '暂无会话';
  $('#zstatTok').textContent = fmtTok(zl.today.in + zl.today.out);
  $('#zstatTok').title = `输入 ${fmtTok(zl.today.in)} · 输出 ${fmtTok(zl.today.out)}`;
  $('#zstatReq').textContent = String(zl.today.reqs);
  $('#zstatModel').textContent = zl.topModel ? zl.topModel.name : '—';
  $('#zstatModel').title = zl.topModel ? zl.topModel.name : '';
  $('#zstatShare').textContent = zl.topModel ? Math.round(zl.topModel.share * 100) + '% 占比' : '暂无会话';

  /* 头部时间 */
  const at = curTab === 'zcode' ? z.at : (k.usage ? k.usage.at : k.snapshotAt);
  const ageEl = $('#age');
  ageEl.textContent = at ? fmtAgo(at) : '';
  const stale = at && (now - at > (curTab === 'zcode' ? 5 : 20) * 60 * 1000);
  ageEl.classList.toggle('warn', !!stale);
  document.getElementById('view-' + curTab).classList.toggle('stale', !!stale);

  /* 药丸：跟随当前页；开启轮换时两个应用都有数据则每 15 秒交替，标签带前缀便于区分 */
  let pt = curTab;
  if (rotatePill) {
    const zHas = limits.length > 0;
    const cHas = !!(cw && (cw.five || cw.week));
    if (zHas && cHas) pt = Math.floor(Date.now() / 15000) % 2 === 0 ? 'zcode' : 'claude';
    else if (cHas) pt = 'claude';
  }
  if (pt === 'zcode') {
    setMeter('pm1', limits[0] ? { pct: limits[0].percentage } : null, 'Z·5小时');
    setMeter('pm2', limits[1] ? { pct: limits[1].percentage } : null, 'Z·周额度');
  } else {
    setMeter('pm1', cw && cw.five, 'C·5小时');
    setMeter('pm2', cw && cw.week, 'C·7天');
  }

  applyPetState();
  scheduleFit();
}

/* ---------- 窗口自适应：内容多了扩窗、少了缩窗，始终贴合 ---------- */
let fitTimer = null;
function scheduleFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(fitWindow, 250);
}
function fitWindow() {
  if (document.body.classList.contains('view-pill')) return;
  const v = document.getElementById('view-' + curTab);
  if (!v || !v.lastElementChild) return;
  // 溢出才扩窗
  const over = v.scrollHeight - v.clientHeight;
  if (over > 4) { window.moss.fitHeight(over + 4); return; }
  // space-between 会把富余摊进子元素间隙，scrollHeight 量不出来——
  // 改为按"子元素高度 + 外边距 + 内边距"求自然高度，双向都能感知
  const cvs = getComputedStyle(v);
  let natural = parseFloat(cvs.paddingTop) + parseFloat(cvs.paddingBottom);
  for (const child of v.children) {
    const cs = getComputedStyle(child);
    if (cs.display === 'none' || cs.position === 'absolute') continue;
    natural += child.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
  }
  const delta = Math.round(natural - v.clientHeight);
  // 双向收敛：富余 10px 以上缩窗留 6px；溢出 4px 以上扩窗
  if (delta < -10) window.moss.fitHeight(delta + 6);
  else if (delta > 4) window.moss.fitHeight(delta + 2);
  else window.moss.reportCardHeight(curTab, Math.round(innerHeight));
}

/* ---------- 宠物状态机（9 行素材全覆盖） ---------- */
let baseState = 'idle';
let petBusy = false;

function collectPcts() {
  const pcts = zLimits().map(l => l.percentage || 0);
  const cw = claudeWindows();
  if (cw) {
    if (cw.five && cw.five.pct != null) pcts.push(cw.five.pct);
    if (cw.week && cw.week.pct != null) pcts.push(cw.week.pct);
  }
  return pcts;
}

function applyPetState() {
  if (!latest) return;
  const pcts = collectPcts();
  const maxPct = pcts.length ? Math.max(...pcts) : 0;

  if (maxPct >= 85 && prevMaxPct < 85) {
    say(`警告：最高额度已消耗 ${Math.round(maxPct)}%。`);
    speakTTS('警告。检测到编码额度剩余不足百分之十五。');
  }
  else if (maxPct >= 60 && prevMaxPct < 60) say(`提示：额度消耗已过半（${Math.round(maxPct)}%）。`);
  if (prevMaxPct > 50 && maxPct < prevMaxPct - 30) say('检测到额度窗口重置。');
  prevMaxPct = maxPct;

  const k = latest.claude;
  const zk = latest.zcode;
  const active = (k.lastActivityAt && (Date.now() - k.lastActivityAt < 120 * 1000))
    || (zk.lastActivityAt && (Date.now() - zk.lastActivityAt < 120 * 1000));
  const stale = !latest.bigmodel.at || (Date.now() - latest.bigmodel.at > 15 * 60 * 1000);
  document.getElementById('pet').classList.toggle('dim', stale);

  baseState = maxPct >= 85 ? 'alert' : (active ? 'work' : 'idle');
  if (!petBusy) pet.setState(baseState);
}

// 空闲小动作：素材 9 行全覆盖（0 常驻待机，1/2/6/7 轮换彩蛋，3 招呼，8 拖拽）
const IDLE_TREATS = [
  { name: 'sway', ms: 2600 }, { name: 'lean', ms: 3200 },
  { name: 'pose', ms: 3400 }, { name: 'pose2', ms: 3000 },
];
setInterval(() => {
  if (petBusy || baseState !== 'idle' || document.hidden) return;
  if (Math.random() > 0.4) return;
  petBusy = true;
  const pickOne = () => IDLE_TREATS[Math.floor(Math.random() * IDLE_TREATS.length)];
  const t1 = pickOne();
  pet.setState(t1.name);
  setTimeout(() => {
    // 三成概率连做两个动作，更像自言自语
    if (Math.random() < 0.3 && baseState === 'idle') {
      const t2 = pickOne();
      pet.setState(t2.name);
      setTimeout(() => { petBusy = false; pet.setState(baseState); }, t2.ms);
    } else {
      petBusy = false;
      pet.setState(baseState);
    }
  }, t1.ms);
}, 9000);

/* ---------- 宠物实例与交互 ---------- */
const pet = new MossPet(document.getElementById('pet'));

function wireInteraction() {
  const wrap = $('#pet-wrap');
  let down = false, moved = false;

  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // 右键/中键留给菜单，不当成点击
    down = true; moved = false; wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!down || e.buttons !== 1) return; // 仅左键拖动
    const dx = e.movementX, dy = e.movementY;
    if (dx || dy) {
      if (!moved && Math.abs(dx) + Math.abs(dy) > 2) { moved = true; pet.setState('drag'); }
      if (moved) window.moss.dragBy(dx, dy);
    }
  });
  wrap.addEventListener('pointerup', (e) => {
    if (e.button !== 0 && e.button !== -1) { down = false; return; }
    if (down && !moved) {
      petBusy = true;
      pet.playOnce('greet', () => { petBusy = false; pet.setState(baseState); });
      const parts = [];
      const zl = zLimits();
      if (zl.length) parts.push(`ZCode 最高 ${Math.round(Math.max(...zl.map(l => l.percentage || 0)))}%`);
      const cw = claudeWindows();
      if (cw && cw.five) parts.push(`Claude 5h ${Math.round(cw.five.pct)}%`);
      say(parts.length ? `报告：${parts.join('，')}。` : '数据同步中，请稍候。');
      switchView();
    }
    down = false;
    if (moved) { petBusy = false; pet.setState(baseState); }
  });
  // 右键菜单在 contextmenu 事件里处理，上面 pointerup 只响应左键
  wrap.addEventListener('contextmenu', (e) => { e.preventDefault(); window.moss.contextMenu(); });

  for (const zone of [$('#pill'), $('#head')]) {
    let dDown = false;
    zone.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.srcTab, .chev, .dot, #btnDetail')) return;
      dDown = true; zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (dDown && (e.movementX || e.movementY)) window.moss.dragBy(e.movementX, e.movementY);
    });
    zone.addEventListener('pointerup', () => { dDown = false; });
  }

  document.querySelectorAll('.srcTab').forEach(t => t.addEventListener('click', () => {
    setTab(t.dataset.tab, true);
  }));

  // 额度明细浮层（ZCode 标签页头部"明细"按钮触发）
  const btn = $('#btnDetail');
  if (btn) btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = $('#detailPop');
    const open = pop.classList.toggle('open');
    btn.textContent = open ? '收起' : '明细';
  });
  document.addEventListener('click', (e) => {
    const pop = $('#detailPop');
    if (pop && pop.classList.contains('open') && !e.target.closest('#detailPop, #btnDetail')) {
      pop.classList.remove('open');
      $('#btnDetail').textContent = '明细';
    }
  });

  $('#toPill').addEventListener('click', () => switchView('pill'));
  $('#toCard').addEventListener('click', () => switchView('card'));

  for (const d of [$('#homeDot'), $('#pillDot')]) {
    d.addEventListener('dblclick', () => { window.moss.resetPos(); say('坐标已归位。'); });
  }

  for (const id of ['#kheatDays', '#zheatDays']) {
    const el = $(id);
    if (el) el.addEventListener('click', () => {
      const idx = HEAT_RANGES.findIndex(r => r.id === heatRangeId);
      heatRangeId = HEAT_RANGES[(idx + 1) % HEAT_RANGES.length].id;
      pref.set('heatRange', heatRangeId);
      if (latest) render();
    });
  }

  document.addEventListener('mousemove', (e) => {
    const hit = !!(e.target && e.target.closest && e.target.closest('.interactive'));
    window.moss.passthrough(!hit);
  });
}

function setTab(tab, save) {
  curTab = tab;
  document.body.classList.toggle('tab-zcode', tab === 'zcode');
  document.body.classList.toggle('tab-claude', tab === 'claude');
  document.querySelectorAll('.srcTab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  if (save) pref.set('tab', tab);
  window.moss.setTab(tab); // 告知主进程当前页（记忆高度/自适应用）
  if (latest) render();
}

function switchView(force) {
  const to = force || (document.body.classList.contains('view-card') ? 'pill' : 'card');
  document.body.classList.toggle('view-card', to === 'card');
  document.body.classList.toggle('view-pill', to === 'pill');
  pref.set('view', to);
  window.moss.setView(to, curTab);
  if (to === 'card') window.moss.syncHint(); // 用户主动看面板 = 自然刷新时机（主进程有随机冷却）
}

/* ---------- 启动 ---------- */
buildThemes();
applyTheme(pref.get('theme', 'auto'));
setTab(curTab === 'claude' ? 'claude' : 'zcode', false);
wireInteraction();

const savedView = pref.get('view', 'card');
if (savedView === 'pill') {
  document.body.classList.add('view-pill');
  document.body.classList.remove('view-card');
  window.moss.setView('pill');
}

window.moss.onSystemAccent((c) => {
  sysAccent = c;
  if (pref.get('theme', 'auto') === 'auto') applyTheme('auto');
});
window.moss.onCfg((c) => {
  rotatePill = !!c.pillRotate;
  ttsOn = !!c.ttsWarning;
});
window.moss.onSetView((v) => {
  document.body.classList.toggle('view-card', v === 'card');
  document.body.classList.toggle('view-pill', v === 'pill');
  pref.set('view', v);
  if (v === 'card') setTimeout(fitWindow, 60); // 尽快收敛，避免两段缩放被看见
});
window.moss.onDebugTab((t) => setTab(t, false));

let greeted = false;
let lastVerifyWarned = false;
window.moss.onUsage((s) => {
  latest = s;
  render();
  if (!greeted) { greeted = true; say('MOSS 在线，监控已启动。'); }
  const e = s.claude && s.claude.usageErr ? String(s.claude.usageErr) : '';
  if (e && (e.includes('验证') || e.includes('403')) && !lastVerifyWarned) {
    lastVerifyWarned = true;
    say('MOSS 需要你通过一次人机验证，请点击弹出的验证窗口。', 8000);
  }
  if (!e) lastVerifyWarned = false;
});

window.moss.onClaudeStatus((m) => { if (m) say('MOSS：' + m, 6000); });

// 宠物缩放（托盘/右键菜单或 config.pet.scale）
window.moss.onPetScale((scale) => {
  const s = Math.max(0.5, Math.min(1.6, Number(scale) || 1));
  const wrap = document.getElementById('pet-wrap');
  const pet2 = document.getElementById('pet');
  if (wrap) { wrap.style.width = Math.round(178 * s) + 'px'; }
  if (pet2) { pet2.style.width = Math.round(176 * s) + 'px'; pet2.style.height = Math.round(191 * s) + 'px'; }
});
