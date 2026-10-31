# 加载 MOSS 皮肤

[返回项目首页](../README.md)

首页效果图使用 **skerio** 发布在 [Codex Pet 社区](https://codex-pet.org)的 MOSS 皮肤，形象来自《流浪地球》系列。源码内置简约皮肤，渲染器支持读取本地 8 列 × 9 行精灵图。

## 获取皮肤

已通过 Codex Pet 安装过 MOSS 时，可以直接使用已有文件。首次获取的安装命令为：

```powershell
npx codex-pet-installer add moss
```

该安装器的默认下载站点为 Codex Pet。可在站点查看 MOSS 条目和作者信息。安装后，精灵图通常位于 `%USERPROFILE%\.codex\pets\moss\spritesheet.webp`。

## 接入用量组件

在本项目根目录运行：

```powershell
New-Item -ItemType Directory -Force assets\moss | Out-Null
Copy-Item "$env:USERPROFILE\.codex\pets\moss\spritesheet.webp" assets\moss\spritesheet.webp
```

打开 `renderer/panel.js`，将宠物实例这一行：

```javascript
const pet = new MossPet(document.getElementById('pet'));
```

改为：

```javascript
const pet = new MossPet(document.getElementById('pet'), '../assets/moss/spritesheet.webp');
```

保存后重启组件，即可使用 MOSS 皮肤。`assets/moss/` 已列入 Git 忽略规则，作为本机外观配置保存。

## 素材来源

- 发布者：**skerio**，平台：[Codex Pet](https://codex-pet.org)。
- 获取入口：`npx codex-pet-installer add moss`。
- MOSS 形象及精灵素材保留各自权利；本项目自有代码采用 MIT。
- 首页图片展示该皮肤下的组件效果，额度及用量使用示例数据。
