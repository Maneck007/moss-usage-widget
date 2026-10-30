'use strict';
// 智谱 GLM Coding Plan 用量查询
// 接口: GET {base}/api/monitor/usage/quota/limit
// 认证: Authorization: <key>（无 Bearer 前缀）
// 响应: { code, data: { level, limits: [ { type, unit, number, usage, currentValue, remaining, percentage, nextResetTime } ] } }

async function pollQuota(cfg) {
  const url = `${(cfg.bigmodelBase || 'https://open.bigmodel.cn').replace(/\/$/, '')}/api/monitor/usage/quota/limit`;
  const res = await fetch(url, {
    headers: {
      'Authorization': cfg.bigmodelApiKey,
      'Accept-Language': 'en-US,en',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const data = j && (j.data || j);
  const limits = Array.isArray(data && data.limits) ? data.limits : [];
  return {
    at: Date.now(),
    level: (data && data.level) || null,
    limits: limits.map(l => ({
      type: l.type,
      unit: l.unit,
      number: l.number,
      total: l.usage,
      used: l.currentValue,
      remaining: l.remaining,
      percentage: l.percentage,
      nextResetTime: l.nextResetTime,
    })),
  };
}

// unit 编码是猜测值，遇到未知编码时回退为原始值展示
const UNIT_NAMES = { 3: '小时', 6: '周' };
function limitLabel(l) {
  const u = UNIT_NAMES[l.unit];
  if (u) return `${l.number}${u}`;
  return l.type === 'TOKENS_LIMIT' ? '5小时' : `窗口(${l.number}/u${l.unit})`;
}

module.exports = { pollQuota, limitLabel };
