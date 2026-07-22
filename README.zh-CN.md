# TopPlan

[English](README.md)

TopPlan 是一款面向 Windows 的轻量桌面计划工具，用于写下今日计划、随手记录进展，并让重要事项始终留在视线内。它以本地 Markdown 文件为核心，不把简单的每日安排变成复杂的项目管理系统。

## 下载与安装

请从 [GitHub Releases](https://github.com/haoiew/TopPlan/releases/latest) 下载最新 Windows 安装包。TopPlan 支持 64 位 Windows 10 及更高版本；需要 Microsoft Edge WebView2 Runtime，大多数新版 Windows 已自带该组件。

## 核心特点

- **以今天为中心**：可使用单一 Markdown 计划，也可按 `YYYY-MM-DD.md` 创建工作日文件，在合适的时机迁移未完成任务。
- **记录快，回看清楚**：支持富文本与源码两种 Markdown 编辑方式，可处理任务清单、时间标签、链接、代码块和本地图片。
- **常驻但不打扰**：主窗口可置顶；重要文件可打开为不占任务栏的迷你便签；仅需查看时可启用鼠标穿透。
- **文件始终属于你**：首次启动自行选择数据目录，TopPlan 直接读写普通 `.md` 文件，不需要账号或云端服务。
- **不增加额外负担**：可按单文件、双栏文档或每日滚动方式使用，无需先建立项目、数据库或协作空间。

## 设计理念

TopPlan 只专注一件事：让今天该做什么保持可见，完成时快速记录，未完成但重要的内容自然进入下一个工作日。界面保持紧凑，计划可以一直放在桌面上，而不会占据工作空间。

Markdown 是长期保存的记录格式。它可迁移、可在应用外阅读，也始终由你掌控。TopPlan 在此基础上提供更快的编辑体验和每日计划流程，而不将内容锁定在专有数据模型中。

## 开始使用

1. 安装并打开 TopPlan。
2. 首次启动时选择本地计划文件目录。
3. 编辑 `TopPlan.md`，或启用工作日文件并从今天的计划开始。
4. 将需要持续查看的文件打开为迷你便签。

## 开发

TopPlan 基于 Tauri 2、Svelte 5、TypeScript、CodeMirror 6 和 TipTap 构建。

```powershell
pnpm install
pnpm check
pnpm test:e2e
pnpm tauri build
```

Windows 桌面构建需要 Rust、Microsoft C++ Build Tools 和 WebView2。不要将项目依赖安装到 Miniforge 的 base 环境。

## 本地数据

- 首次启动选择的数据目录仅保存在本地。
- 已有 Markdown 文件会直接使用，不会被迁移。
- `.topplan/image-index.json` 是可重建的本地图片索引，不属于源数据。
- 仓库已忽略应用本地数据及保存在仓库根目录的个人 Markdown 文件。

## 许可证与署名

TopPlan 使用 [Creative Commons Attribution 4.0 International](LICENSE) 许可证。你可以使用、修改和分发本项目，包括商业用途。

分享修改版本或基于 TopPlan 的产品时，请保留 [NOTICE](NOTICE) 中的署名信息：标注 `TopPlan` 和 `Haoiew`，附上项目来源与许可证链接，并明确说明修改内容。
