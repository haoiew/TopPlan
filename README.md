# TopPlan

TopPlan is a lightweight Windows desktop planner built with Tauri 2, Svelte, TypeScript, CodeMirror 6, and TipTap. It keeps compact Markdown editing surfaces on top of the desktop so interrupted work can be captured quickly.

## Current Capabilities

- Local-only data. The first launch asks for a data folder and reads existing `.md` files directly.
- Default single-file workflow with `TopPlan.md`.
- Optional workday file mode using `YYYY-MM-DD.md`, Chinese statutory holiday/adjusted-workday data, and automatic plan rollover.
- Rich Markdown editing, source editing, and persistent two-file left/right editing.
- Markdown task lists, links, code blocks, and local images.
- Mini note windows for opening Markdown files as taskbar-free always-on-top widgets, including click-through mode.
- Mini note opacity and background color settings.
- Editor zoom controls with cursor and scroll position preservation between editor modes.
- Local image reference index in `.topplan/image-index.json`.
- Pasted-image storage, reconciliation of unused pasted images, and cleanup of stale deleted image assets.
- Always-on-top frameless window, tray menu, single-instance behavior, global hotkey plumbing, and autostart setting.

## Project Environment

Do not install dependencies into the base Miniforge environment.

Preferred environment creation command:

```powershell
mamba create -y -n topplan -c conda-forge nodejs=24 pnpm git
```

In this setup session, `mamba create` and `mamba create --dry-run` both stalled during solving with no progress output. The environment was created in the same Miniforge env location with:

```powershell
conda create -y -p C:\Users\138721\AppData\Local\miniforge3\envs\topplan -c conda-forge nodejs=24 pnpm git
```

Use the project environment tools directly:

```powershell
& 'C:\Users\138721\AppData\Local\miniforge3\envs\topplan\Library\share\pnpm\node_modules\.bin\pnpm.cmd' install
```

## Windows Prerequisites

Tauri Windows builds also require Rust and Microsoft C++ Build Tools.

- WebView2 Runtime: detected on this machine.
- Rust toolchain: detected after running the downloaded `rustup-init.exe` directly.
- Microsoft C++ Build Tools: not detected by `vswhere`; this is still required before `pnpm tauri dev` or `pnpm tauri build`.

Verify Rust and install Microsoft C++ Build Tools before running Tauri build/dev commands:

```powershell
rustup default stable
cargo -V
rustc -V
```

## Development Commands

Frontend-only type/build checks:

```powershell
pnpm check
pnpm build
```

Desktop development after Rust/MSVC prerequisites are installed:

```powershell
pnpm tauri dev
```

Windows installer build:

```powershell
pnpm tauri build
```

## Data Directory Rules

- Select any local folder as the TopPlan workspace.
- Existing `.md` files are treated as historical plan files and are not migrated.
- If no Markdown files exist, TopPlan creates `TopPlan.md`.
- With daily mode enabled, TopPlan creates or opens the current workday file in the main/right pane and preserves a manually opened left pane.
- Local image paths are resolved in this order:
  1. Current Markdown file directory
  2. Workspace root
  3. Absolute path
- `.topplan/image-index.json` is rebuildable and should not be treated as source data.
