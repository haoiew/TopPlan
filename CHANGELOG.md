# Changelog

## 2026-07-08

Changes relative to `c11afbc` (`fix: improve desktop editing and tray behavior`).

### Added

- Added a TipTap-based rich Markdown editor with task list and image support while keeping the CodeMirror source editor available.
- Added mini note windows for opening Markdown files as small always-on-top notes, including opacity and background color settings.
- Added image data URL loading for local images, pasted-image reconciliation, and cleanup for stale deleted image assets.
- Added editor zoom controls and scroll/cursor anchoring between rich and source editing modes.
- Added window frame controls for mini mode, including custom dragging, resizing, shadow toggling, and size limits.

### Changed

- Replaced the markdown-it rendering stack with TipTap Markdown packages.
- Updated desktop permissions for the new mini-note windows and window-management APIs.
- Improved bilingual UI text for task insertion, mini-note actions, and mini-note settings.

### Removed

- Removed the old markdown-it renderer and interruption template helper.
