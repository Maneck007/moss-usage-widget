'use strict';
// 由 Claude Code 的 statusLine 机制调用（stdin 为 JSON）。
// 职责：1) 把 rate_limits 快照到 ~/.moss-usage-widget/claude-snapshot.json
//       2) 向 stdout 打一行状态栏文字
const fs = require('fs');
const path = require('path');
const os = require('os');

const OUT = path.join(os.homedir(), '.moss-usage-widget', 'claude-snapshot.json');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let j = null;
  try { j = JSON.parse(raw); } catch { /* 非 JSON 输入，只显示默认文本 */ }

  if (j) {
    const rl = j.rate_limits || j.rateLimits;
    if (rl && typeof rl === 'object') {
      try {
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, JSON.stringify({ at: Date.now(), rate_limits: rl }));
      } catch { /* 快照写失败不影响状态栏 */ }
    }
  }

  const model = (j && j.model && (j.model.display_name || j.model.id)) || '';
  let line = 'MOSS';
  if (model) line += ` | ${model}`;
  if (j && j.rate_limits) {
    const rl = j.rate_limits;
    const pct = x => (x && typeof x.used_percentage === 'number') ? `${Math.round(x.used_percentage)}%` : '?';
    if (rl.five_hour) line += ` | 5h ${pct(rl.five_hour)}`;
    if (rl.seven_day) line += ` · 7d ${pct(rl.seven_day)}`;
  }
  console.log(line);
});
