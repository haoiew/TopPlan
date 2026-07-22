# TopPlan

[简体中文](README.zh-CN.md)

TopPlan is a lightweight Windows desktop planner for today’s plan and quick records. It stays close to the desktop, keeps your content in plain Markdown files, and avoids turning a simple daily plan into a complex project-management system.

## Download

Download the latest Windows installer from [GitHub Releases](https://github.com/haoiew/TopPlan/releases/latest). TopPlan supports 64-bit Windows 10 and later; the Microsoft Edge WebView2 Runtime is required and is already included with most current Windows installations.

## Core Features

- **Today-first planning**: work in one Markdown plan or generate workday files named `YYYY-MM-DD.md`, with unfinished tasks carried forward when appropriate.
- **Fast capture, readable later**: edit Markdown in rich-text or source mode, including task lists, timestamps, links, code blocks, and local images.
- **Focused desktop presence**: keep the frameless window on top, open small taskbar-free mini notes, and enable click-through when a note should only be visible.
- **Your files stay yours**: choose a local data folder on first launch. TopPlan reads and writes ordinary `.md` files directly; it does not require an account or cloud service.
- **Useful without ceremony**: use a single plan, two side-by-side documents, or daily rollover without setting up projects, databases, or collaboration spaces.

## Design Principles

TopPlan is designed around a narrow job: make today’s work visible, record it as it happens, and carry the important unfinished pieces into the next workday. The interface stays compact so the plan can remain available without taking over the screen.

Markdown is the long-term format of record. It keeps plans portable, readable outside the app, and under your control. The app adds fast editing and daily workflow support without locking the content into a proprietary data model.

## Getting Started

1. Install and open TopPlan.
2. Select a local folder for plan files on first launch.
3. Edit `TopPlan.md`, or enable workday files and start with today’s plan.
4. Open an important file as a mini note when it should stay visible on the desktop.

## Development

TopPlan is built with Tauri 2, Svelte 5, TypeScript, CodeMirror 6, and TipTap.

```powershell
pnpm install
pnpm check
pnpm test:e2e
pnpm tauri build
```

Desktop builds require Rust, Microsoft C++ Build Tools, and WebView2 on Windows. Do not install project dependencies into the Miniforge base environment.

## Local Data

- The first launch asks for a data folder; this data remains local.
- Existing Markdown files are used directly and are not migrated.
- `.topplan/image-index.json` is a rebuildable local image index, not source data.
- The repository ignores local application data and personal Markdown files stored at the repository root.

## License and Attribution

TopPlan is available under the [Creative Commons Attribution 4.0 International](LICENSE) license. You may use, modify, and distribute it, including for commercial purposes.

When sharing a modified version or a product based on TopPlan, retain the attribution in [NOTICE](NOTICE): credit `TopPlan` by `Haoiew`, link to the project source and license, and clearly state any changes you made.
