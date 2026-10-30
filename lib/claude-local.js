'use strict';
// 扫描 Claude Code / Claude 桌面端 code 模式的会话记录 ~/.claude/projects/**/*.jsonl
// 增量扫描：文件字节偏移 + 每日聚合结果一并持久化，二次扫描零开销。
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const CACHE_FILE = path.join(os.homedir(), '.moss-usage-widget', 'claude-scan-cache.json');

// cache.files: { 绝对路径: { size, mtime, offset } }
// cache.days:  { 'YYYY-MM-DD': { in, out, reqs } }  —— 全量聚合，不随窗口截断
// cache.models: { 模型名: tokens } —— 用于主力模型占比
let cache = { files: {}, days: {}, models: {}, lastActivityAt: 0 };
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { /* 首次 */ }
if (!cache.files) cache.files = {};
if (!cache.days) cache.days = {};
if (!cache.models) cache.models = {};
if (!cache.lastActivityAt) cache.lastActivityAt = 0;
let cacheDirty = false;

function flushCache() {
  if (!cacheDirty) return;
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  cacheDirty = false;
}

function listTranscripts() {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(ROOT, { withFileTypes: true, recursive: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.jsonl')) {
      // recursive 模式下 parentPath 在新版 Node 是绝对路径，旧版是相对 ROOT 的父路径
      const parent = e.parentPath || e.path || '';
      out.push(path.isAbsolute(parent) ? path.join(parent, e.name) : path.join(ROOT, parent, e.name));
    }
  }
  return out;
}

function dayKeyLocal(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function extractUsage(obj) {
  const m = obj.message || obj;
  const u = m.usage || obj.usage;
  if (!u) return null;
  return {
    in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    out: u.output_tokens || 0,
  };
}

function scan() {
  for (const file of listTranscripts()) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const prev = cache.files[file];
    if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) continue; // 未变化
    let offset = 0;
    if (prev && st.size >= prev.offset) offset = prev.offset;

    let fh;
    try { fh = fs.openSync(file, 'r'); } catch { continue; }
    try {
      const len = st.size - offset;
      if (len > 0) {
        const buf = Buffer.alloc(len);
        fs.readSync(fh, buf, 0, len, offset);
        const text = buf.toString('utf8');
        const lastNl = text.lastIndexOf('\n');
        const usable = lastNl >= 0 ? text.slice(0, lastNl + 1) : '';
        if (usable) {
          for (const line of usable.split('\n')) {
            if (!line || line[0] !== '{') continue;
            let obj; try { obj = JSON.parse(line); } catch { continue; }
            let ts = obj.timestamp ? Date.parse(obj.timestamp) : 0;
            if (!Number.isFinite(ts) || !ts) {
              const st = obj.startTime ? Date.parse(obj.startTime) : NaN;
              ts = Number.isFinite(st) ? st : 0;
            }
            // 会话汇总行（无 usage，带 totalCostUSD 会话累计成本）：按文件最后更新日归属
            // （跨天会话的成本全部记到最后活跃日，即"这个会话到目前为止花了多少"）
            const sessionCost = Number(obj.totalCostUSD) || 0;
            if (sessionCost > 0) {
              const key0 = dayKeyLocal(new Date(st.mtimeMs || ts));
              const rec0 = cache.days[key0] || (cache.days[key0] = { in: 0, out: 0, reqs: 0, cost: 0 });
              rec0.cost = Math.max(rec0.cost || 0, sessionCost);
            }
            const u = extractUsage(obj);
            if (!u || !ts) continue;
            const cost = Number(obj.costUSD ?? (obj.message && obj.message.costUSD)) || 0;
            const model = (obj.message && obj.message.model) || obj.model;
            if (typeof model === 'string' && model) {
              cache.models[model] = (cache.models[model] || 0) + u.in + u.out;
            }
            if (ts > cache.lastActivityAt) cache.lastActivityAt = ts;
            const key = dayKeyLocal(new Date(ts));
            const rec = cache.days[key] || (cache.days[key] = { in: 0, out: 0, reqs: 0, cost: 0 });
            rec.in += u.in; rec.out += u.out; rec.reqs += 1;
            // costUSD 是会话累计成本：取当日出现过的最大值 ≈ 当日花费
            if (cost > 0) rec.cost = Math.max(rec.cost || 0, cost);
          }
          cache.files[file] = { size: st.size, mtime: st.mtimeMs, offset: offset + Buffer.byteLength(usable) };
          cacheDirty = true;
        } else {
          cache.files[file] = { size: st.size, mtime: st.mtimeMs, offset };
        }
      } else {
        cache.files[file] = { size: st.size, mtime: st.mtimeMs, offset };
      }
    } finally { fs.closeSync(fh); }
  }
  flushCache();

  // 由全量聚合裁出展示窗口
  const now = new Date();
  const win = [];
  for (let i = 144; i >= 0; i--) {   // 扫描窗口 145 天：覆盖热力图"长"档
    const d = new Date(now); d.setDate(now.getDate() - i);
    const key = dayKeyLocal(d);
    const rec = cache.days[key] || { in: 0, out: 0, reqs: 0, cost: 0 };
    win.push({ d: key, in: rec.in, out: rec.out, reqs: rec.reqs, cost: rec.cost || 0 });
  }
  const today = win[win.length - 1];

  // 主力模型：按 token 量取第一名
  let topModel = null;
  const entries = Object.entries(cache.models).sort((a, b) => b[1] - a[1]);
  if (entries.length) {
    const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
    topModel = { name: fmtModelName(entries[0][0]), share: entries[0][1] / total };
  }

  return {
    today: { in: today.in, out: today.out, reqs: today.reqs, cost: today.cost || 0 },
    days14: win.slice(-14),
    heat: win.map(x => ({ d: x.d, total: x.in + x.out })),
    lastActivityAt: cache.lastActivityAt,
    topModel,

  };
}

// 'claude-opus-5-5' → 'Opus 5.5'
function fmtModelName(raw) {
  const m = raw.match(/claude[-_]?([a-z]+)[-_]?([\d.]+[-_\d.]*)/i);
  if (!m) return raw;
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return `${name} ${m[2].replace(/-/g, '.')}`;
}

module.exports = { scan };
