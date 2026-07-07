import type { AppSettings } from '../types';

export const DEFAULT_FILE_NAME = 'TopPlan.md';
export const AUTOSAVE_DELAY_MS = 800;
export const DEFAULT_HOTKEY = 'Ctrl+Alt+Space';

export const DEFAULT_MARKDOWN = `# TopPlan

## 今日计划
- [ ] 

## 被打断任务

## 临时记录
`;

export const DEFAULT_SETTINGS: AppSettings = {
  workspaceRoot: null,
  activeFilePath: null,
  window: {
    x: 0,
    y: 0,
    width: 420,
    height: 640,
    alwaysOnTop: true,
  },
  hotkey: DEFAULT_HOTKEY,
  autoStart: false,
  dailyFile: {
    enabled: false,
    pattern: 'YYYY-MM-DD.md',
  },
  theme: 'light',
  language: 'zh',
};

export function todayFileName(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}.md`;
}

export function interruptionTemplate(date = new Date()): string {
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `\n- [ ] ${hour}:${minute} 被打断：\n  - 已完成：\n  - 下一步：\n`;
}
