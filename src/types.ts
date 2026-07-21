export type ThemeMode = 'system' | 'light' | 'dark';
export type LanguageMode = 'zh' | 'en';
export type ViewMode = 'edit' | 'preview' | 'split';
export type ImageStatus = 'ok' | 'missing' | 'external';

export interface AppSettings {
  workspaceRoot: string | null;
  activeFilePath: string | null;
  window: {
    x: number;
    y: number;
    width: number;
    height: number;
    alwaysOnTop: boolean;
  };
  hotkey: string;
  autoStart: boolean;
  dailyFile: {
    enabled: boolean;
    pattern: 'YYYY-MM-DD.md';
  };
  splitView: {
    leftFilePath: string | null;
  };
  miniNote: {
    opacity: number;
    backgroundColor: string;
  };
  theme: ThemeMode;
  language: LanguageMode;
}

export interface PlanFile {
  path: string;
  name: string;
  modifiedAt: string;
  size: number;
  isActive: boolean;
}

export interface ImageReference {
  sourceFile: string;
  line: number;
  rawPath: string;
  resolvedPath: string | null;
  status: ImageStatus;
  dataUrl?: string;
}

export interface WorkspaceSnapshot {
  files: PlanFile[];
  content: string;
  images: ImageReference[];
}
