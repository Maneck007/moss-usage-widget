# MOSS Usage Widget

**写代码时，抬眼就知道 Claude / ZCode 用到哪了。**

写到兴头上，才发现额度快用完了。MOSS 把两边的额度和本地用量放在桌面一角：想看细节就展开卡片，专心工作时收成一枚小药丸，旁边还有一只会动的小机器人。

[开始使用](#开始使用) · [下载源码](https://github.com/Maneck007/moss-usage-widget/releases/latest) · [配置与常见问题](docs/USAGE.md) · [反馈建议](https://github.com/Maneck007/moss-usage-widget/issues)

[![Checks](https://github.com/Maneck007/moss-usage-widget/actions/workflows/checks.yml/badge.svg)](https://github.com/Maneck007/moss-usage-widget/actions/workflows/checks.yml)

![MOSS 的 Claude、ZCode 卡片与紧凑药丸；界面使用示例数据展示](docs/overview.png)

*真实界面，示例数据。百分比表示已用额度；本地 token 记录和订阅额度分别统计。*

## 少切几次页面，多看一眼桌面

| 你想知道 | MOSS 怎么展示 |
|---|---|
| 这轮额度还剩多少？ | Claude / ZCode 已用百分比和重置倒计时，不用反复打开用量页 |
| 最近用得多不多？ | 近 14 天用量柱状图、35 / 91 / 140 天活动热力图 |
| 今天主要在用什么？ | 本地 token、主力模型与占比；ZCode 请求数、Claude 近似成本 |
| 不想让面板挡住工作？ | 卡片与药丸一键切换，可拖动、切换配色，也可跟随系统主题 |

额度升高时，颜色会从绿变为琥珀、红色；小机器人也会切换状态。想要语音提醒，可以在配置中开启。

## 开始使用

适合在 **Windows 10/11** 上使用 Claude / ZCode 的人。当前提供源码，需要 **Node.js 22.12+（推荐 24）和 npm**，暂时没有免安装 exe。

```powershell
git clone https://github.com/Maneck007/moss-usage-widget.git
cd moss-usage-widget
npm ci
Copy-Item config.example.json config.json
npm start
```

先打开看看，不必一次配齐所有功能：

- **先看本地统计**：有 Claude / ZCode 会话日志时，无需密钥即可显示相应的 token 记录。
- **再接入账号额度**：按[配置说明](docs/USAGE.md#数据与配置)填写自己的 `config.json`；两边可以分别配置。
- **放到顺手的位置**：拖动卡片或机器人；点击机器人或按 `Ctrl+Alt+M` 切换卡片 / 药丸。

依赖安装好后，也可双击 `启动.vbs` 静默启动。默认关闭跟随启动和 Claude statusLine 安装；需要时再启用。更多操作、数据位置和卸载方法见[使用说明](docs/USAGE.md)。

## 使用前了解

Claude 额度依赖网页接口及本人登录状态，可能需要人工验证，也可能随网页变化失效。密钥和 sessionKey 只保存在自己的配置里。留空账号凭据，仍可使用已有日志的本地统计。本地成本是记录中的近似值，不是订阅账单。

## 来源与参与

界面思路与部分样式参考 [yuemuqing-thu/claude-usage-widget](https://github.com/yuemuqing-thu/claude-usage-widget)，完整声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。公开版的几何机器人和托盘图标为原创，原个人版的 MOSS 精灵图不随仓库分发；项目与《流浪地球》、Anthropic、智谱均无官方关联。

本项目使用 [MIT 许可](LICENSE)，借助 ZCode 等 AI 编程工具开发，由维护者审阅与验证。想改进它，欢迎[提 Issue](https://github.com/Maneck007/moss-usage-widget/issues) 或按[贡献说明](CONTRIBUTING.md)提交 PR；反馈时请去除私人日志和凭据。
