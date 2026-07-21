import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { register, type ShortcutEvent } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow, LogicalSize, type PhysicalPosition, type PhysicalSize } from '@tauri-apps/api/window';
import type { AppSettings, ImageReference, PlanFile } from '../types';

export type ResizeDirection = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';
export type WindowFrame = {
  position: PhysicalPosition;
  size: PhysicalSize;
};
export type MiniNoteContentUpdate = {
  sourceLabel: string;
  path: string;
  content: string;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauriRuntime = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

function requireTauri(): void {
  if (!isTauriRuntime) {
    throw new Error('TopPlan desktop APIs are available when the app runs through Tauri.');
  }
}

export async function getSettings(): Promise<AppSettings> {
  requireTauri();
  return invoke<AppSettings>('get_settings');
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  requireTauri();
  await invoke('save_settings', { settings });
}

export async function selectWorkspaceDir(): Promise<string | null> {
  requireTauri();
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select TopPlan data folder',
  });
  return typeof selected === 'string' ? selected : null;
}

export async function listMarkdownFiles(workspaceRoot: string, activeFilePath: string | null): Promise<PlanFile[]> {
  requireTauri();
  return invoke<PlanFile[]>('list_markdown_files', { workspaceRoot, activeFilePath });
}

export async function createMarkdownFile(workspaceRoot: string, name: string, content: string): Promise<PlanFile> {
  requireTauri();
  return invoke<PlanFile>('create_markdown_file', { workspaceRoot, name, content });
}

export async function renameMarkdownFile(path: string, newName: string): Promise<PlanFile> {
  requireTauri();
  return invoke<PlanFile>('rename_markdown_file', { path, newName });
}

export async function readMarkdownFile(path: string): Promise<string> {
  requireTauri();
  return invoke<string>('read_markdown_file', { path });
}

export async function writeMarkdownFile(path: string, content: string): Promise<void> {
  requireTauri();
  await invoke('write_markdown_file', { path, content });
}

export async function scanImageReferences(workspaceRoot: string): Promise<ImageReference[]> {
  requireTauri();
  return invoke<ImageReference[]>('scan_image_references', { workspaceRoot });
}

export async function cleanupStaleDeletedImages(workspaceRoot: string, maxAgeHours = 24): Promise<void> {
  requireTauri();
  await invoke('cleanup_stale_deleted_images', { workspaceRoot, maxAgeHours });
}

export async function readLocalImageDataUrl(path: string): Promise<string> {
  requireTauri();
  return invoke<string>('read_local_image_data_url', { path });
}

export async function reconcilePictureAssets(activeFilePath: string, content: string): Promise<void> {
  requireTauri();
  await invoke('reconcile_picture_assets', { activeFilePath, content });
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  requireTauri();
  await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
}

export async function setWindowShadow(enabled: boolean): Promise<void> {
  requireTauri();
  await getCurrentWindow().setShadow(enabled);
}

export async function hideWindow(): Promise<void> {
  requireTauri();
  await getCurrentWindow().hide();
}

export async function closeWindow(): Promise<void> {
  requireTauri();
  await getCurrentWindow().close();
}

export async function minimizeWindow(): Promise<void> {
  requireTauri();
  await getCurrentWindow().minimize();
}

export async function startWindowDrag(): Promise<void> {
  requireTauri();
  await getCurrentWindow().startDragging();
}

export async function startWindowResize(direction: ResizeDirection): Promise<void> {
  requireTauri();
  await getCurrentWindow().startResizeDragging(direction);
}

export async function getWindowInnerSize(): Promise<PhysicalSize> {
  requireTauri();
  return getCurrentWindow().innerSize();
}

export async function getWindowFrame(): Promise<WindowFrame> {
  requireTauri();
  const window = getCurrentWindow();
  const [position, size] = await Promise.all([window.outerPosition(), window.outerSize()]);
  return { position, size };
}

export async function setWindowFrame(frame: WindowFrame): Promise<void> {
  requireTauri();
  const window = getCurrentWindow();
  await window.setSize(frame.size);
  await window.setPosition(frame.position);
}

export async function setWindowInnerSize(width: number, height: number): Promise<void> {
  requireTauri();
  await getCurrentWindow().setSize(new LogicalSize(width, height));
}

export async function setWindowSizeLimits(minWidth?: number, minHeight?: number, maxWidth?: number, maxHeight?: number): Promise<void> {
  requireTauri();
  const window = getCurrentWindow();
  await window.setMinSize(minWidth && minHeight ? new LogicalSize(minWidth, minHeight) : null);
  await window.setMaxSize(maxWidth && maxHeight ? new LogicalSize(maxWidth, maxHeight) : null);
}

export async function toggleAppWindows(): Promise<void> {
  requireTauri();
  await invoke('toggle_app_windows');
}

export async function openMiniNoteWindow(path: string): Promise<void> {
  requireTauri();
  await invoke('open_mini_note_window', { path });
}

export async function openMiniNotePair(paths: [string, string]): Promise<void> {
  requireTauri();
  await invoke('open_mini_note_pair', { paths });
}

export async function setMainSplitOpen(open: boolean): Promise<void> {
  requireTauri();
  await invoke('set_main_split_open', { open });
}

export function currentWindowLabel(): string {
  requireTauri();
  return getCurrentWindow().label;
}

export async function setMiniNoteClickThrough(parentLabel: string, enabled: boolean): Promise<void> {
  requireTauri();
  await invoke('set_mini_note_click_through', { parentLabel, enabled });
}

export async function onMiniNoteClickThroughChanged(callback: (enabled: boolean) => void): Promise<() => void> {
  requireTauri();
  return listen<boolean>('mini-note-click-through-changed', (event) => callback(event.payload));
}

export async function openFileInMain(path: string): Promise<void> {
  requireTauri();
  await invoke('open_file_in_main', { path });
}

export async function onOpenFileInMain(callback: (path: string) => void | Promise<void>): Promise<() => void> {
  requireTauri();
  return listen<string>('open-file-in-main', (event) => {
    void callback(event.payload);
  });
}

export async function broadcastMiniNoteSettings(miniNote: AppSettings['miniNote']): Promise<void> {
  requireTauri();
  await emit('mini-note-settings-changed', miniNote);
}

export async function onMiniNoteSettingsChanged(callback: (miniNote: AppSettings['miniNote']) => void | Promise<void>): Promise<() => void> {
  requireTauri();
  return listen<AppSettings['miniNote']>('mini-note-settings-changed', (event) => {
    void callback(event.payload);
  });
}

export async function broadcastMiniNoteContent(path: string, content: string): Promise<void> {
  requireTauri();
  await emit('mini-note-content-changed', {
    sourceLabel: getCurrentWindow().label,
    path,
    content,
  } satisfies MiniNoteContentUpdate);
}

export async function onMiniNoteContentChanged(callback: (payload: MiniNoteContentUpdate) => void | Promise<void>): Promise<() => void> {
  requireTauri();
  return listen<MiniNoteContentUpdate>('mini-note-content-changed', (event) => {
    if (event.payload.sourceLabel === getCurrentWindow().label) {
      return;
    }
    void callback(event.payload);
  });
}

export async function savePastedImage(activeFilePath: string, bytes: number[], extension: string): Promise<string> {
  requireTauri();
  return invoke<string>('save_pasted_image', { activeFilePath, bytes, extension });
}

export async function configureAutostart(enabled: boolean): Promise<boolean> {
  requireTauri();
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
  return isEnabled();
}

export async function configureGlobalHotkey(hotkey: string, callback: (event: ShortcutEvent) => void): Promise<void> {
  requireTauri();
  try {
    await register(hotkey, callback);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('already registered')) {
      throw error;
    }
  }
}
