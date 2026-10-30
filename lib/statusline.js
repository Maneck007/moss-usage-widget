'use strict';
// statusLine 安装器：把快照脚本注册进 ~/.claude/settings.json
// Claude Code（CLI 或桌面端 code 模式）每次刷新状态栏都会执行它，
// 把包含 rate_limits（官方额度百分比）的 stdin JSON 快照到固定文件。
const fs = require('fs');
const path = require('path');
const os = require('os');

function install(appDir) {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* 无配置或非法，之后整体写出 */ }

  const runner = path.join(appDir, 'lib', 'statusline-runner.js').replace(/\\/g, '/');
  const want = { type: 'command', command: `node "${runner}"` };

  if (settings.statusLine) {
    const cur = typeof settings.statusLine.command === 'string' ? settings.statusLine.command : '';
    if (cur.includes('statusline-runner.js')) return; // 已是本工具的，更新路径即可
    console.log('[moss] 检测到已有 statusLine，跳过安装：', cur);
    return;
  }

  const backup = settingsPath + '.before-moss';
  if (fs.existsSync(settingsPath) && !fs.existsSync(backup)) {
    fs.copyFileSync(settingsPath, backup);
  }
  settings.statusLine = want;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log('[moss] statusLine 已安装，原配置备份于', backup);
}

module.exports = { install };
