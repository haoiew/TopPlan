# Windows WebView2 鼠标穿透方案调研

调研日期：2026-07-21

## 结论

目前没有发现一个同时满足以下条件的现成方案：开源、维护成熟、可直接接入 Tauri 2、能在 Windows WebView2 的可调整大小半透明窗口中可靠整窗穿透、又能保留一个独立可点击控制按钮。

能找到的 Tauri 插件和示例，大多仍然调用 `set_ignore_cursor_events`，或只给顶层 HWND 增加 `WS_EX_TRANSPARENT`。它们没有解决 TopPlan 已经遇到的 WebView2 子 HWND 截获输入问题，因此不建议直接安装到生产代码。

如果必须保留 Tauri，最值得做隔离原型验证的是 Faksimile 的“分层窗口 + 色键透明 + 动态切换整窗 `WS_EX_TRANSPARENT`”方案；长期更干净的方向是等待或采用 WRY 的 WebView2 CompositionController/DirectComposition 托管，但当前相关 WRY PR 尚未合并。若允许迁移框架，Electron 的官方实现是目前最成熟、产品化程度最高的方案。

## TopPlan 实施结果（2026-07-22）

后续原生窗口探测确认，TopPlan 不需要迁移框架或引入额外依赖。主要故障是同步 Tauri 命令在创建独立控制 WebView 时阻塞事件循环，导致穿透样式没有及时完整应用；同时 WebView2 会动态产生新的子 HWND。当前实现改为异步命令，保存并恢复每个 HWND 的原始扩展样式，并在穿透期间持续同步新出现的子窗口。独立的 22×22 像素透明控制窗保留关闭入口。

后台原生测试已覆盖双便签、连续两轮启用/关闭、全局状态同步、控制窗数量和尺寸，以及 `WindowFromPoint` 在启用后命中背后应用、关闭后重新命中便签本身。因此本文下方的候选方案仍作为能力边界调研保留，但迁移 Electron、色键窗口或维护 WRY 分支不再是当前推荐动作。

## TopPlan 当前技术基线

TopPlan 当前锁定 Tauri 2.11.5、Tao 0.35.3 和 WRY 0.55.1。Tauri 的窗口 API 最终委托给 Tao；Tao 在 Windows 上只对其窗口 HWND 切换 `WS_EX_TRANSPARENT | WS_EX_LAYERED`。[Tauri API](https://docs.rs/tauri/2.11.5/tauri/window/struct.Window.html#method.set_ignore_cursor_events) [Tao 0.35.3 Windows 源码](https://docs.rs/crate/tao/0.35.3/source/src/platform_impl/windows/window_state.rs)

TopPlan 已进一步枚举 WebView2 子 HWND，保存原始扩展样式，并在开启穿透时给子窗口增加 `WS_EX_TRANSPARENT`、关闭时恢复基线。这个方向与近期合并到 YUI 项目的修复基本一致；YUI 的后续修复也特别说明，不能直接清除 WebView2 渲染窗口原生携带的透明位，否则会导致 DirectComposition 表面空白。[YUI PR #238](https://github.com/yw0nam/YUI/pull/238)

由于 TopPlan 在采用这条路径后仍出现“内容可勾选/滚动、背后程序不可点击”，说明问题已经不是前端蒙版或普通 DOM 事件，而是当前 WebView2 原生窗口树、合成宿主或样式应用时机与这一通用补丁不完全匹配。

## 候选方案评估

| 方案 | 成熟度与实现 | 对 TopPlan 的适配结论 |
| --- | --- | --- |
| Tauri `set_ignore_cursor_events` | 官方、稳定；但 Tauri 的 `forward` 能力仍是开放需求，透明区域自动判断也没有内建支持。[Tauri issue #6164](https://github.com/tauri-apps/tauri/issues/6164) [Tauri issue #2090](https://github.com/tauri-apps/tauri/issues/2090) | API 本身成熟，但在当前 Windows WebView2 窗口结构中能力不足，不能作为单独修复。 |
| [`tauri-plugin-penetrable`](https://github.com/sner21/tauri-plugin-penetrable) | crates.io 0.1.4，总下载约 5.4k，最后更新于 2024-10；单维护者、无测试。代码通过窗口标题 `FindWindowW` 查找顶层窗口，只在启动时增加 `WS_EX_TRANSPARENT | WS_EX_LAYERED`，没有关闭/恢复和子 HWND 处理。[crates.io 元数据](https://crates.io/api/v1/crates/tauri-plugin-penetrable) | 比 Tauri 自带 API 更弱，无法解决当前故障，不应采用。 |
| [`tauri-plugin-polygon`](https://github.com/houycth/tauri-plugin-polygon) | crates.io 0.1.2，总下载约 2.7k，22 个提交、2 位贡献者，最后更新于 2024-11。文档限定全屏透明应用；使用 `rdev` 的全局鼠标钩子，在鼠标进入/离开多边形时切换 Tauri `set_ignore_cursor_events`。[crates.io 元数据](https://crates.io/api/v1/crates/tauri-plugin-polygon) | 它仍依赖 TopPlan 已验证不完整的底层 API，并引入全局输入钩子；窗口模型也与可缩放便签不符。不建议采用。 |
| [`tauri-clickthrough-demo`](https://github.com/Xinyu-Li-123/tauri-clickthrough-demo) | 5 个提交、无发布版的示例项目。用 `rdev` 获取全局鼠标位置，再按前端命中区域反复切换 `setIgnoreCursorEvents`。该思路也被 Tauri issue #13070 的讨论引用。[Tauri issue #13070](https://github.com/tauri-apps/tauri/issues/13070) | 可参考状态机和 DPI 坐标换算，但没有修复 WebView2 子 HWND 问题，不是可用依赖。 |
| [`WebView2-Click-Through`](https://github.com/Faksimile/WebView2-Click-Through) | 2 个提交、单贡献者、无发布版的 Win32 C++ 示例。宿主使用 `WS_EX_LAYERED` 和 `LWA_COLORKEY`；WebView2 默认背景与 HTML 背景使用同一色键，并根据鼠标是否位于控件上切换整个宿主的 `WS_EX_TRANSPARENT`。 | 不是成熟库，但它绕开了“只修改普通 Tauri/WebView2 窗口样式”的做法，是保留 Tauri 时最值得做原型验证的现有实现。风险是色键透明可能与 TopPlan 的半透明背景、圆角、阴影和抗锯齿冲突。 |
| WebView2 CompositionController | 微软官方视觉托管 API。宿主直接接收鼠标/指针输入，再通过 `SendMouseInput`/`SendPointerInput` 有选择地转发给 WebView2，因此能够从架构上决定哪些区域响应输入。[Microsoft ICoreWebView2Environment3](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environment3#createcorewebview2compositioncontroller) [CompositionController](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2compositioncontroller) | 原生 API成熟，适合精确命中控制；但 TopPlan 当前 WRY 0.55.1 没有暴露该路径。WRY 的 DirectComposition 视觉托管仍处于开放 PR，直接采用需要维护 WRY 分支或自行嵌入 WebView2。[WRY PR #1762](https://github.com/tauri-apps/wry/pull/1762) |
| Wails | Wails v3 当前源码已经有 `IgnoreMouseEvents` 和 `WebView2CompositionHosting`，但 v3 最新发布线仍是 alpha；稳定的 v2 没有同等组合能力。[Wails 源码](https://github.com/wailsapp/wails/blob/master/v3/pkg/application/webview_window_windows.go) [Wails v3 tags](https://github.com/wailsapp/wails/tags) | 需要把 Rust 后端迁移到 Go，并承担 alpha 框架风险，不适合作为本次缺陷修复。可作为架构参考。 |
| Electron | 官方 `BrowserWindow.setIgnoreMouseEvents(ignore, { forward })` 已产品化多年；Windows 实现直接在 Chromium accelerated widget 上切换 `WS_EX_TRANSPARENT | WS_EX_LAYERED`，并支持继续向 Chromium 转发鼠标移动。[Electron API](https://www.electronjs.org/docs/latest/api/browser-window#winsetignoremouseeventsignore-options) [Electron Windows 源码](https://github.com/electron/electron/blob/main/shell/browser/native_window_views.cc) | 开源成熟度最高、功能最接近需求，但意味着从 Tauri 迁移到 Electron，包体和内存也会明显增加。 |

## 推荐决策

### 保留 Tauri：推荐顺序

1. 先做一个不进入生产路径的 Win32 诊断层，记录顶层 HWND 与全部后代 HWND 的类名、线程/进程、扩展样式和 `WM_NCHITTEST` 结果，分别对比开启前、开启后、滚动后和窗口重建后。当前最需要确认的是：真正接收输入的窗口是否晚于首次枚举创建，或是否属于非子窗口/独立合成窗口。
2. 做 Faksimile 色键分层宿主的最小原型，只替换单个便签窗口，不动主界面与 Markdown 数据逻辑。穿透关闭按钮继续使用现有独立小窗口。
3. 如果色键方案破坏半透明视觉效果，则评估基于 WRY PR #1762 的临时分支，或等待其正式合并发布。该方案成本更高，但输入所有权清晰，长期维护性更好。
4. 如果必须在短期内获得确定的 Windows 穿透行为，优先评估“主程序保持 Tauri、便签显示改为独立原生 Windows 渲染层”，其次才是整体迁移 Electron。

不建议继续安装或叠加 `tauri-plugin-penetrable`、`tauri-plugin-polygon`。前者没有处理 WebView2 子窗口，后者只是用全局鼠标钩子驱动同一个 Tauri API；它们不会消除当前根因，反而会增加输入状态失锁和按钮失效的可能性。

## 后台测试计划

以下测试不接管用户鼠标：

1. 单元测试 Win32 样式状态机，确保每个 HWND 使用首次观察到的基线样式恢复，重复开关保持幂等。
2. 增加只读诊断命令，后台枚举窗口树并写入测试日志；验证 WebView2 重建子窗口后仍能同步样式。
3. 使用专用测试窗口作为底层探针，通过 `WindowFromPoint`、`RealChildWindowFromPoint` 和 `WM_NCHITTEST` 检查指定屏幕坐标的命中对象，不移动鼠标、不发送真实点击。
4. 覆盖 100%、125%、150% DPI，单便签/双便签，窗口移动/缩放，滚轮区域、复选框区域、空白区域和独立关闭按钮。
5. 自动验证关闭穿透后全部原始样式恢复、编辑和拖动重新可用，且不会残留不可点击顶栏。
6. 最后一项跨进程真实点击只能由用户手动验收：在便签背后放置一个明确可点击目标，开启穿透后由用户点击并确认底层应用收到事件；Codex 只读取日志和结果，不控制鼠标。

## 最终判断

“现成开源”方案有，但“成熟且可直接解决 TopPlan 当前问题”的方案没有。最接近即插即用的两个 Tauri 插件都没有越过当前故障的技术边界；真正成熟的是 Electron 的完整实现，真正适合留在 WebView2 架构内的是 CompositionController，但它尚未成为当前 Tauri/WRY 的稳定能力。
