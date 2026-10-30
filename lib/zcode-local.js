'use strict';
// 扫描 ZCode 桌面端本地推理日志 ~/.zcode/cli/rollout/model-io-*.jsonl
// 每行：{ completedAt, model: { modelId }, response: { usage: {...} } }（usage 字段名有 snake/camel 两种形态，做兼容）
// 增量扫描：文件字节偏移 + 每日聚合持久化
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), '.zcode', 'cli', 'rollout');
const CACHE_FILE = path.join(os.homedir(), '.moss-usage-widget', 'zcode-scan-cache.json');

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

function listLogs() {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(ROOT); } catch { return out; }
  for (const n of names) {
    if (n.startsWith('model-io-') && n.endsWith('.jsonl')) out.push(path.join(ROOT, n));
  }
  return out;
}

function dayKeyLocal(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function extractUsage(obj) {
  const u = (obj.response && obj.response.usage) || obj.usage;
  if (!u) return null;
  const inTok = u.input_tokens ?? u.inputTokens ?? 0;
  const outTok = u.output_tokens ?? u.outputTokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? u.cacheReadTokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? u.cacheWriteTokens ?? 0;
  if (!inTok && !outTok && !cacheRead && !cacheWrite) return null;
  return { in: inTok + cacheRead + cacheWrite, out: outTok };
}

function scan() {
  for (const file of listLogs()) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const prev = cache.files[file];
    if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) continue;
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
            const u = extractUsage(obj);
            if (!u) continue;
            const ts = obj.completedAt ? Date.parse(obj.completedAt) : 0;
            if (!ts) continue;
            if (ts > cache.lastActivityAt) cache.lastActivityAt = ts;
            const key = dayKeyLocal(new Date(ts));
            const rec = cache.days[key] || (cache.days[key] = { in: 0, out: 0, reqs: 0 });
            rec.in += u.in; rec.out += u.out; rec.reqs += 1;
            const mid = (obj.model && obj.model.modelId) || 'unknown';
            cache.models[mid] = (cache.models[mid] || 0) + u.in + u.out;
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

  const now = new Date();
  const win = [];
  for (let i = 144; i >= 0; i--) {   // 扫描窗口 145 天：覆盖热力图"长"档
    const d = new Date(now); d.setDate(now.getDate() - i);
    const key = dayKeyLocal(d);
    const rec = cache.days[key] || { in: 0, out: 0, reqs: 0 };
    win.push({ d: key, in: rec.in, out: rec.out, reqs: rec.reqs });
  }
  const today = win[win.length - 1];

  let topModel = null;
  const entries = Object.entries(cache.models).sort((a, b) => b[1] - a[1]);
  if (entries.length) {
    const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
    topModel = { name: entries[0][0], share: entries[0][1] / total };
  }

  return {
    today: { in: today.in, out: today.out, reqs: today.reqs },
    days14: win.slice(-14),
    heat: win.map(x => ({ d: x.d, total: x.in + x.out })),
    lastActivityAt: cache.lastActivityAt,
    topModel,
  };
}

module.exports = { scan };
