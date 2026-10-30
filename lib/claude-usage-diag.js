'use strict';
// 一次性诊断脚本：用与主应用完全相同的网络路径（Electron net.fetch）测试用量接口
// 运行：npx electron lib/claude-usage-diag.js
const { app } = require('electron');
const path = require('path');
const cfg = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const claudeUsage = require('./claude-usage');

app.whenReady().then(async () => {
  setTimeout(() => { console.log('DIAG TIMEOUT'); app.exit(2); }, 120000); // 强制退出保险
  try {
    const r = await claudeUsage.pollUsage(cfg);
    console.log('DIAG OK', JSON.stringify(r));
  } catch (e) {
    console.log('DIAG FAIL:', e.message);
  }
  app.quit();
});
