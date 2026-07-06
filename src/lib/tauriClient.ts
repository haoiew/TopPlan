import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AppSettings, ImageReference, PlanFile } from '../types';

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

export function localAssetUrl(path: string): string {
  return convertFileSrc(path);
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  requireTauri();
  await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
}

export async function hideWindow(): Promise<void> {
  requireTauri();
  await getCurrentWindow().hide();
}

export async function toggleMainWindow(): Promise<void> {
  requireTauri();
  await invoke('toggle_main_window');
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

export async function configureGlobalHotkey(hotkey: string, callback: () => void): Promise<void> {
  requireTauri();
  await unregisterAll();
  await register(hotkey, callback);
}
