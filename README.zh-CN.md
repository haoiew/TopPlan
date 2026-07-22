# TopPlan - 本地优先的今日计划与记录工具

[English](README.md) | 简体中文

[![最新版本](https://img.shields.io/github/v/release/haoiew/TopPlan?display_name=tag&sort=semver)](https://github.com/haoiew/TopPlan/releases/latest)
[![许可证：CC BY 4.0](https://img.shields.io/github/license/haoiew/TopPlan)](LICENSE)

TopPlan 是一款开源、本地优先的今日计划与 Markdown 任务记录工具，用来写下当天安排、快速记录工作进展，并让重要事项始终留在桌面视线内。它不需要账号、云服务或复杂的项目管理配置，打开即可开始记录。

![TopPlan 双栏显示今日计划与工作记录](docs/assets/topplan-overview.png)

**[下载最新版本](https://github.com/haoiew/TopPlan/releases/latest)**

## 为什么选择 TopPlan

许多效率工具围绕项目、团队和数据库设计。TopPlan 专注于更小但每天都会发生的事情：确定今天最重要的工作，在执行过程中保持可见，随时记录进展，并将未完成任务自然带入下一个工作日。

- **开始足够快**：打开一个本地 Markdown 文件即可规划今天。
- **本地优先、方便迁移**：`.md` 文件可由任意编辑器读取，始终由你掌控。
- **常驻但不抢占工作空间**：可使用紧凑置顶窗口或不占任务栏的迷你便签。
- **需要时再增加结构**：按需启用工作日文件、任务滚动、父子任务或双栏编辑。

## 核心特点

- 使用 `TopPlan.md` 或按 `YYYY-MM-DD.md` 命名的工作日文件管理每日计划。
- 根据中国法定节假日和调休工作日迁移未完成任务。
- 支持富文本与源码两种 Markdown 编辑方式，可处理任务清单、时间标签、链接、代码块和本地图片。
- 支持父子任务联动、可视缩进和双文档分栏编辑。
- 支持无边框置顶主窗口、迷你便签、透明度设置和鼠标穿透。
- 本地维护图片索引并清理废弃图片，不将计划内容上传到远程服务。

## 快速开始

1. 从 [GitHub Releases](https://github.com/haoiew/TopPlan/releases/latest) 下载并安装 TopPlan。
2. 首次启动时选择本地 Markdown 计划文件目录。
3. 编辑 `TopPlan.md`，或启用工作日文件并从今天的计划开始。
4. 将需要持续查看的文件打开为桌面迷你便签。

当前版本支持 64 位 Windows 10 及更高版本。应用需要 Microsoft Edge WebView2 Runtime，大多数新版系统已自带该组件。安装包尚未进行代码签名，因此系统可能显示未知发布者提示。

## 设计理念

TopPlan 刻意保持聚焦：今天的工作应该持续可见，记录过程应该足够快速，文件的寿命也应该长于应用本身。Markdown 是长期保存格式，桌面应用只负责提供更专注的编辑体验和每日计划流程，不将内容锁定在专有数据模型中。

## 数据与隐私

- 首次启动选择的数据目录仅保存在本地，不需要账号或云端服务。
- 已有 Markdown 文件会被直接使用，不会迁移到数据库。
- `.topplan/image-index.json` 是可重建的本地图片索引，不属于源数据。
- 仓库已忽略应用本地数据及保存在仓库根目录的个人 Markdown 文件。

## 反馈与贡献

欢迎通过 [GitHub Issues](https://github.com/haoiew/TopPlan/issues) 提交问题、功能建议和边界清晰的 Pull Request。如果 TopPlan 对你有帮助，可以 Star 仓库帮助更多人发现项目，并持续关注后续版本。

## 开发

TopPlan 基于 Tauri 2、Svelte 5、TypeScript、CodeMirror 6 和 TipTap 构建。

```powershell
pnpm install
pnpm check
pnpm test:e2e
pnpm tauri build
```

Windows 桌面构建需要 Rust、Microsoft C++ Build Tools 和 WebView2。不要将项目依赖安装到 Miniforge 的 base 环境。

## 引用

可使用 GitHub 仓库侧栏的 **Cite this repository** 功能导出 APA 或 BibTeX 格式的 TopPlan 引用信息。引用元数据保存在 [CITATION.cff](CITATION.cff)。

## 许可证与署名

TopPlan 使用 [Creative Commons Attribution 4.0 International](LICENSE) 许可证。你可以使用、修改和分发本项目，包括商业用途。

分享修改版本或基于 TopPlan 的产品时，请保留 [NOTICE](NOTICE) 中的署名信息：标注 `TopPlan` 和 `Haoiew`，附上项目来源与许可证链接，并明确说明修改内容。
