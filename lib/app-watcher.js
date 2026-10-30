'use strict';
// 跟随启动看护：把一个隐身 VBS 写入 Windows 启动文件夹。
// 该看护常驻后台（无窗口、几乎零开销），每 5 秒检查一次：
//   - ZCode 或 Claude（进程名可在 config.watchProcesses 配置）启动时 → 静默拉起本监视器
//   - 用户手动关闭监视器后，不会立刻反复拉起（等下次应用重新启动才再拉）
// 这样"开机自启"与"跟随应用启动"合二为一，且全程无命令行窗口。

const fs = require('fs');
const path = require('path');

const VBS_NAME = 'moss-usage-widget.vbs';

function startupDir() {
  return path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}
function vbsPath() { return path.join(startupDir(), VBS_NAME); }

function vbsContent(appDir, watchList) {
  const electronExe = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fs.existsSync(electronExe)) throw new Error('electron.exe 不存在，请先 npm install');
  const list = (watchList && watchList.length ? watchList : ['ZCode.exe', 'claude.exe'])
    .map(s => String(s).replace(/'/g, ''));
  const procLines = list.map((name, i) => `procs(${i}) = "${name}"`).join('\r\n');
  // VBS 数组需上界，这里固定给到 9 个槽位（够用）
  return `' MOSS 用量监视器 · 跟随启动看护（本脚本隐身常驻，无窗口）
' ZCode / Claude 任一启动时自动拉起监视器；进程名单改 config.json 的 watchProcesses 后重装
Option Explicit
Dim sh, wmi, prevApp, launched, i, appNow, wRun
Set sh = CreateObject("WScript.Shell")
Dim procs(9)
${procLines}
For i = ${list.length} To 9
  procs(i) = ""
Next
Const WIDGET_DIR = "${appDir.replace(/"/g, '')}"
Const ELECTRON = "${electronExe.replace(/"/g, '')}"
prevApp = False
launched = False
Do While True
  appNow = False
  wRun = False
  On Error Resume Next
  Set wmi = GetObject("winmgmts:{impersonationLevel=impersonate}!//./root/cimv2")
  For i = 0 To 9
    If procs(i) <> "" Then
      If wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='" & procs(i) & "'").Count > 0 Then appNow = True
    End If
  Next
  If wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE CommandLine LIKE '%moss-usage-widget%' AND Name='electron.exe'").Count > 0 Then wRun = True
  On Error GoTo 0
  If appNow And Not wRun And Not prevApp Then
    sh.Run """" & ELECTRON & """ """ & WIDGET_DIR & """", 0, False
    launched = True
  End If
  If Not appNow Then launched = False
  prevApp = appNow
  WScript.Sleep 5000
Loop
`;
}

function apply(enable, appDir, watchList) {
  const vbs = vbsPath();
  if (enable) {
    fs.writeFileSync(vbs, vbsContent(appDir, watchList));
  } else {
    try { fs.unlinkSync(vbs); } catch { /* 本来就没有 */ }
  }
  return vbs;
}

module.exports = { apply, vbsPath };
