# MOSS Usage Widget

Windows 桌面用量悬浮窗：在 ZCode 和 Claude 两个标签页中查看额度、本地 token 趋势与活动热力图，支持完整卡片、紧凑药丸和主题切换。

公开版使用原创 Canvas 几何机器人和托盘图标。早期个人版本的 MOSS 精灵图没有随仓库分发；项目名沿用开发时的名称，与《流浪地球》、Anthropic、智谱均无官方关联。

## 安装和启动

需要 Windows 10/11、Node.js 22.12+（推荐 Node.js 24）和 npm。

```powershell
git clone https://github.com/Maneck007/moss-usage-widget.git
cd moss-usage-widget
npm ci
Copy-Item config.example.json config.json
npm start
```

依赖安装后，也可双击 `启动.vbs` 静默启动，路径由脚本所在目录确定。第一次启动会在缺少配置时自动复制示例文件。默认不安装启动看护和 Claude statusLine，不配置密钥时也能打开面板。

## 数据与配置

| 内容 | 来源 | 配置 |
|---|---|---|
| ZCode 编码计划额度 | 智谱用量接口 | 本地 `config.json` 的 `bigmodelApiKey` |
| Claude 订阅额度 | 隐藏浏览器窗口加载 claude.ai 用量页，捕获页面响应 | 本地 `claudeSessionKey`；可能需要本人登录或完成人机验证 |
| Claude 本地统计 | `~/.claude/projects/` 的会话日志 | 无需密钥 |
| ZCode 本地统计 | `~/.zcode/cli/rollout/` 的推理日志 | 无需密钥 |

Claude 额度同步依赖未公开承诺稳定的网页行为。sessionKey 是账号凭据，只填写在自己的 `config.json`，不要放入 Issue、截图、聊天或仓库。登录方式与 Cookie 名称以你实际使用的 claude.ai 页面为准；本工具不会自动提取浏览器凭据。

Claude 额度使用 Electron Chromium 网络栈及其系统代理配置；实际出口应以启动日志为准。使用相同网络栈并不保证与另一个客户端具有相同 TLS 指纹，也不能保证账号无风险。留空 `claudeSessionKey` 可只使用本地统计。

本地成本展示来自会话累计成本的近似归属，不是订阅账单或额外扣费。缺少日志或相应字段时不会有完整统计。

## 操作

| 操作 | 效果 |
|---|---|
| 左键机器人 / Ctrl+Alt+M | 切换卡片与药丸 |
| 拖动机器人或卡片顶栏 | 移动窗口 |
| 卡片顶部标签 | 切换 ZCode / Claude |
| 底部色点 | 跟随系统或选择主题 |
| 热力图天数标签 | 切换 35 / 91 / 140 天 |
| ZCode 的“明细”按钮 | 查看额度详情 |
| 右键机器人 | 刷新、大小、跟随启动、配置与退出 |

额度状态色为绿色、琥珀色（≥60%）、红色（≥85%）。药丸可轮换两平台数据；语音告警通过 `ttsWarning` 开启，默认关闭。

## 本地文件与卸载

配置在项目目录的 `config.json`，统计缓存和位置在 `~/.moss-usage-widget/`，网页会话在 Electron 的本地持久分区。这些文件都不应上传。

如果开启了跟随启动，先从右键菜单关闭，再退出应用并删除项目目录。若曾手动启用 `installStatusline`，按备份恢复 `~/.claude/settings.json` 中对应字段。清除本机缓存和 Electron 持久会话时先确认不再需要它们。

## 开发与来源

```powershell
npm run check
npm test
```

界面思路与部分样式实现参考 [yuemuqing-thu/claude-usage-widget](https://github.com/yuemuqing-thu/claude-usage-widget)，其 MIT 声明保存在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本仓库自有代码使用 [MIT](LICENSE)。借助 ZCode 等 AI 编程工具开发，由维护者审阅与验证。

当前发布源码包，需要安装 Node.js 与依赖；尚无独立 exe 安装器。客户端接口可能变化，问题请提交 [Issue](https://github.com/Maneck007/moss-usage-widget/issues)，不要附带真实凭据或私人日志。
