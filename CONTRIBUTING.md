# 参与和维护

问题或建议先提交 [Issue](https://github.com/Maneck007/moss-usage-widget/issues)，写清使用场景、环境和复现步骤。不要上传凭据或私人日志。

## 修改代码

```powershell
git switch main
git pull --ff-only
git switch -c fix/brief-description
```

完成一个明确改动后运行对应检查：

```powershell
npm run check
npm test
```

检查通过后提交并推送：

```powershell
git add <本次修改的文件>
git diff --cached
git commit -m "fix: describe the change"
git push -u origin fix/brief-description
```

在 GitHub 创建 Pull Request，写明原因、变化和验证方式；用 `Closes #编号` 关联 Issue。等待 Actions 检查通过，再阅读 Files changed 并合并。合并后更新本地 main，再删除已合并分支。独立维护者也可用此流程保留审阅记录。

## 发布版本

代码变更在分支中完成；main 保持可用。先更新 CHANGELOG.md，完成相关检查和 PR，再对 main 的确定提交创建 `v0.x.y` 标签，在 Releases 写更新说明。标签固定代码版本，Release 面向使用者提供说明和附件；不要移动已经发布的标签。

新增兼容能力用次版本，兼容性修复用补丁版本。当前 0.x 阶段仍可能调整行为，应在更新说明中明确影响。发行包不含本机配置、数据库、日志或开发对话。
