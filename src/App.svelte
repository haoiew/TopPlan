<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    Clock3,
    Code2,
    FilePlus,
    FileText,
    FolderOpen,
    Image,
    Maximize2,
    Minus,
    NotepadText,
    PanelLeftClose,
    PanelLeftOpen,
    Pin,
    PinOff,
    Pipette,
    RefreshCw,
    Settings,
    SquareChevronDown,
    SquarePlus,
    TriangleAlert,
    X,
  } from '@lucide/svelte';
  import CodeMirrorEditor from './lib/CodeMirrorEditor.svelte';
  import MiniNoteView from './lib/MiniNoteView.svelte';
  import RichMarkdownEditor from './lib/RichMarkdownEditor.svelte';
  import { AUTOSAVE_DELAY_MS, DEFAULT_FILE_NAME, DEFAULT_MARKDOWN, DEFAULT_SETTINGS, todayFileName } from './lib/defaults';
  import { toggleTaskMarkerOnLine } from './lib/markdownView';
  import {
    configureAutostart,
    configureGlobalHotkey,
    broadcastMiniNoteContent,
    broadcastMiniNoteSettings,
    cleanupStaleDeletedImages,
    closeWindow,
    createMarkdownFile,
    getSettings,
    hideWindow,
    isTauriRuntime,
    listMarkdownFiles,
    minimizeWindow,
    onMiniNoteContentChanged,
    onMiniNoteSettingsChanged,
    onOpenFileInMain,
    openFileInMain,
    openMiniNoteWindow,
    readMarkdownFile,
    readLocalImageDataUrl,
    reconcilePictureAssets,
    renameMarkdownFile,
    savePastedImage,
    saveSettings,
    scanImageReferences,
    selectWorkspaceDir,
    setAlwaysOnTop,
    setWindowShadow,
    setWindowSizeLimits,
    startWindowDrag,
    startWindowResize,
    toggleAppWindows,
    writeMarkdownFile,
  } from './lib/tauriClient';
  import { TEXT } from './lib/i18n';
  import type { AppSettings, ImageReference, LanguageMode, PlanFile, ThemeMode } from './types';

  type TransitionMode = 'main' | 'to-mini' | 'mini' | 'to-main';
  type RgbChannel = 'r' | 'g' | 'b';
  type RgbValue = Record<RgbChannel, number>;
  type HsvValue = {
    h: number;
    s: number;
    v: number;
  };
  type EyeDropperConstructor = new () => {
    open: () => Promise<{ sRGBHex: string }>;
  };
  type TopPlanTestApi = {
    setDocument: (markdown: string) => Promise<void>;
    getContent: () => string;
    getRichDebugSnapshot: () => unknown;
  };

  const MINI_TRANSITION_MS = 150;
  const MAIN_ENTER_SETTLE_MS = 24;
  const REDUCED_TRANSITION_MS = 1;
  const MINI_BACKGROUND_PRESETS = ['#ffffff', '#f7fbff', '#f4fbf2', '#fff8ec', '#fff6fa', '#f6f3ff'];
  const MINI_COLOR_CHANNELS: Array<{ key: RgbChannel; label: string }> = [
    { key: 'r', label: 'R' },
    { key: 'g', label: 'G' },
    { key: 'b', label: 'B' },
  ];

  let settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  let files: PlanFile[] = [];
  let images: ImageReference[] = [];
  let content = '';
  let loading = true;
  let saving = false;
  let dirty = false;
  let sidebarOpen = false;
  let sourceMode = false;
  let miniMode = false;
  let transitionMode: TransitionMode = 'main';
  let showSettings = false;
  let showMiniColorPicker = false;
  let desktopPreview = false;
  let errorMessage = '';
  let newFileName = '';
  let scrollVisible = false;
  let zoomVisible = false;
  let zoom = 1;
  let renamingTitle = false;
  let committingTitleRename = false;
  let titleDraft = '';
  let titleInput: HTMLInputElement | null = null;
  let lastHotkeyToggleAt = 0;
  let lastZoomWheelAt = 0;
  let applyingRemoteContent = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let zoomTimer: ReturnType<typeof setTimeout> | null = null;
  type CursorAnchor = {
    line: number;
    yOffset: number;
  };
  const CURSOR_ANCHOR_VIEWPORT_TOLERANCE = 24;
  type NavigationAnchor = { kind: 'cursor'; anchor: CursorAnchor } | { kind: 'top'; line: number };
  let sourceEditor: {
    insertText: (text: string) => void;
    toggleTaskMarkerAtLineStart: () => void;
    getTopLine: () => number;
    scrollToLine: (line: number) => boolean;
    getCursorAnchor: () => CursorAnchor | null;
    setCursorAnchor: (anchor: CursorAnchor) => boolean;
  } | null = null;
  let richEditor: {
    insertMarkdown: (text: string) => void;
    insertTimestamp: (value: string) => void;
    getSelectedSourceLine: () => number;
    getTaskToggleTarget: (markdown: string) => { editorLine: number; documentLine: number };
    getSourceLineAnchor: (line: number) => CursorAnchor;
    getDebugSnapshot: () => unknown;
    insertImage: (path: string) => void;
    getTopLine: () => number;
    scrollToLine: (line: number) => boolean;
    getCursorAnchor: () => CursorAnchor | null;
    setCursorAnchor: (anchor: CursorAnchor) => boolean;
  } | null = null;
  let pendingNavigationAnchor: NavigationAnchor | null = null;
  const ZOOM_STEPS = [0.78, 0.85, 0.9, 0.95, 1, 1.1, 1.2, 1.3, 1.4, 1.5];
  const launchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const isMiniWindow = launchParams.get('topplanMode') === 'mini';
  const launchedMiniFilePath = decodeMiniFilePath(launchParams.get('file'));

  $: activeFile = files.find((file) => file.path === settings.activeFilePath) ?? null;
  $: missingImages = images.filter((item) => item.status === 'missing');
  $: externalImages = images.filter((item) => item.status === 'external');
  $: text = TEXT[settings.language] ?? TEXT.zh;
  $: wordCount = content.replace(/\s+/g, '').length;
  $: miniSurfaceOpacity = settings.miniNote.opacity;
  $: miniBackgroundRgb = colorToRgb(settings.miniNote.backgroundColor);
  $: miniBackgroundChannels = colorToRgbValue(settings.miniNote.backgroundColor);
  $: miniBackgroundHsv = colorToHsv(settings.miniNote.backgroundColor);
  $: miniBackgroundHueColor = hsvToColor({ h: miniBackgroundHsv.h, s: 1, v: 1 });
  $: miniColorEyeDropperAvailable = typeof window !== 'undefined' && 'EyeDropper' in window;
  $: customMiniBackgroundSelected = !MINI_BACKGROUND_PRESETS.includes(settings.miniNote.backgroundColor);
  $: if (!showSettings) {
    showMiniColorPicker = false;
  }

  function cloneSettings(next: Partial<AppSettings>): AppSettings {
    return {
      ...settings,
      ...next,
      window: { ...settings.window, ...(next.window ?? {}) },
      dailyFile: { ...settings.dailyFile, ...(next.dailyFile ?? {}) },
      miniNote: { ...settings.miniNote, ...(next.miniNote ?? {}) },
    };
  }

  function applyTheme(theme: ThemeMode): void {
    document.documentElement.dataset.theme = theme;
  }

  function setError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function transitionDuration(): number {
    return prefersReducedMotion() ? REDUCED_TRANSITION_MS : MINI_TRANSITION_MS;
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function decodeMiniFilePath(value: string | null): string | null {
    if (!value) {
      return null;
    }

    try {
      const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }

  function colorToRgb(color: string): string {
    const normalized = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#ffffff';
    const value = normalized.slice(1);
    return `${parseInt(value.slice(0, 2), 16)} ${parseInt(value.slice(2, 4), 16)} ${parseInt(value.slice(4, 6), 16)}`;
  }

  function normalizeColor(color: string): string {
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '#ffffff';
  }

  function colorToRgbValue(color: string): RgbValue {
    const normalized = normalizeColor(color);
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16),
    };
  }

  function rgbValueToColor(value: RgbValue): string {
    return `#${MINI_COLOR_CHANNELS.map((channel) => value[channel.key].toString(16).padStart(2, '0')).join('')}`;
  }

  function rgbToHsv({ r, g, b }: RgbValue): HsvValue {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;

    if (delta !== 0) {
      if (max === red) {
        hue = ((green - blue) / delta) % 6;
      } else if (max === green) {
        hue = (blue - red) / delta + 2;
      } else {
        hue = (red - green) / delta + 4;
      }
      hue = Math.round(hue * 60);
      if (hue < 0) {
        hue += 360;
      }
    }

    return {
      h: hue,
      s: max === 0 ? 0 : delta / max,
      v: max,
    };
  }

  function hsvToRgb({ h, s, v }: HsvValue): RgbValue {
    const chroma = v * s;
    const hueSegment = h / 60;
    const secondary = chroma * (1 - Math.abs((hueSegment % 2) - 1));
    const match = v - chroma;
    let red = 0;
    let green = 0;
    let blue = 0;

    if (hueSegment >= 0 && hueSegment < 1) {
      red = chroma;
      green = secondary;
    } else if (hueSegment < 2) {
      red = secondary;
      green = chroma;
    } else if (hueSegment < 3) {
      green = chroma;
      blue = secondary;
    } else if (hueSegment < 4) {
      green = secondary;
      blue = chroma;
    } else if (hueSegment < 5) {
      red = secondary;
      blue = chroma;
    } else {
      red = chroma;
      blue = secondary;
    }

    return {
      r: Math.round((red + match) * 255),
      g: Math.round((green + match) * 255),
      b: Math.round((blue + match) * 255),
    };
  }

  function colorToHsv(color: string): HsvValue {
    return rgbToHsv(colorToRgbValue(color));
  }

  function hsvToColor(value: HsvValue): string {
    return rgbValueToColor(hsvToRgb(value));
  }

  function clampColorChannel(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.min(255, Math.max(0, Math.round(parsed)));
  }

  function clampHue(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.min(359, Math.max(0, Math.round(parsed)));
  }

  async function persistSettings(next = settings): Promise<void> {
    settings = next;
    applyTheme(settings.theme);
    if (isTauriRuntime) {
      await saveSettings(settings);
    }
  }

  function scheduleSave(): void {
    dirty = true;
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DELAY_MS);
  }

  async function flushSave(): Promise<void> {
    if (!settings.activeFilePath || !dirty) {
      return;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saving = true;
    try {
      await writeMarkdownFile(settings.activeFilePath, content);
      await reconcilePictureAssets(settings.activeFilePath, content);
      dirty = false;
      await refreshFiles();
      await refreshImages();
    } catch (error) {
      setError(error);
    } finally {
      saving = false;
    }
  }

  async function refreshFiles(): Promise<void> {
    if (!settings.workspaceRoot) {
      files = [];
      return;
    }
    files = await listMarkdownFiles(settings.workspaceRoot, settings.activeFilePath);
  }

  async function refreshImages(): Promise<void> {
    if (!settings.workspaceRoot) {
      images = [];
      return;
    }
    const references = await scanImageReferences(settings.workspaceRoot);
    images = await Promise.all(
      references.map(async (reference) => {
        if (!reference.resolvedPath || reference.status === 'missing') {
          return reference;
        }
        try {
          return {
            ...reference,
            dataUrl: await readLocalImageDataUrl(reference.resolvedPath),
          };
        } catch {
          return reference;
        }
      }),
    );
  }

  async function ensureActiveFile(root: string): Promise<string> {
    const currentFiles = await listMarkdownFiles(root, settings.activeFilePath);

    if (settings.dailyFile.enabled) {
      const name = todayFileName();
      const existing = currentFiles.find((file) => file.name === name);
      if (existing) {
        return existing.path;
      }
      return (await createMarkdownFile(root, name, DEFAULT_MARKDOWN)).path;
    }

    if (settings.activeFilePath && currentFiles.some((file) => file.path === settings.activeFilePath)) {
      return settings.activeFilePath;
    }

    if (currentFiles.length > 0) {
      return currentFiles[0].path;
    }

    return (await createMarkdownFile(root, DEFAULT_FILE_NAME, DEFAULT_MARKDOWN)).path;
  }

  async function openWorkspace(root: string): Promise<void> {
    loading = true;
    errorMessage = '';
    try {
      await cleanupStaleDeletedImages(root, 24);
      const activePath = await ensureActiveFile(root);
      const nextContent = await readMarkdownFile(activePath);
      settings = cloneSettings({ workspaceRoot: root, activeFilePath: activePath });
      content = nextContent;
      dirty = false;
      await refreshFiles();
      await refreshImages();
      await persistSettings(settings);
    } catch (error) {
      setError(error);
    } finally {
      loading = false;
    }
  }

  async function chooseWorkspace(): Promise<void> {
    try {
      const selected = await selectWorkspaceDir();
      if (selected) {
        await openWorkspace(selected);
      }
    } catch (error) {
      setError(error);
    }
  }

  async function switchFile(path: string): Promise<void> {
    if (path === settings.activeFilePath) {
      return;
    }
    await flushSave();
    try {
      const nextContent = await readMarkdownFile(path);
      const settingsSave = persistSettings(cloneSettings({ activeFilePath: path }));
      content = nextContent;
      dirty = false;
      await settingsSave;
      await refreshFiles();
      await refreshImages();
    } catch (error) {
      setError(error);
    }
  }

  async function openFileInMainView(path: string): Promise<void> {
    await flushSave();
    try {
      const nextContent = await readMarkdownFile(path);
      const settingsSave = persistSettings(cloneSettings({ activeFilePath: path }));
      content = nextContent;
      dirty = false;
      await settingsSave;
      await refreshFiles();
      await refreshImages();
      sidebarOpen = false;
      showSettings = false;
    } catch (error) {
      setError(error);
    }
  }

  async function createFile(): Promise<void> {
    if (!settings.workspaceRoot) {
      return;
    }
    const trimmed = newFileName.trim();
    const name = trimmed.endsWith('.md') ? trimmed : `${trimmed || todayFileName()}.md`;
    await flushSave();
    try {
      const created = await createMarkdownFile(settings.workspaceRoot, name, DEFAULT_MARKDOWN);
      newFileName = '';
      const nextContent = await readMarkdownFile(created.path);
      const settingsSave = persistSettings(cloneSettings({ activeFilePath: created.path }));
      content = nextContent;
      dirty = false;
      await settingsSave;
      await refreshFiles();
      await refreshImages();
      sidebarOpen = true;
    } catch (error) {
      setError(error);
    }
  }

  function editableFileName(name: string): string {
    return name.replace(/\.md$/i, '');
  }

  function normalizedMarkdownName(name: string): string {
    const trimmed = name.trim();
    return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
  }

  async function startTitleRename(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (!activeFile) {
      return;
    }
    titleDraft = editableFileName(activeFile.name);
    renamingTitle = true;
    await tick();
    titleInput?.focus();
    titleInput?.select();
  }

  function cancelTitleRename(): void {
    renamingTitle = false;
    titleDraft = '';
  }

  async function commitTitleRename(): Promise<void> {
    if (committingTitleRename) {
      return;
    }
    if (!activeFile) {
      cancelTitleRename();
      return;
    }
    const nextName = normalizedMarkdownName(titleDraft);
    if (!titleDraft.trim() || nextName === activeFile.name) {
      cancelTitleRename();
      return;
    }
    committingTitleRename = true;
    try {
      await flushSave();
      const renamed = await renameMarkdownFile(activeFile.path, nextName);
      await persistSettings(cloneSettings({ activeFilePath: renamed.path }));
      await refreshFiles();
      await refreshImages();
      cancelTitleRename();
    } catch (error) {
      setError(error);
      await tick();
      titleInput?.focus();
      titleInput?.select();
    } finally {
      committingTitleRename = false;
    }
  }

  function handleTitleRenameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitTitleRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelTitleRename();
    }
  }

  async function setTheme(theme: ThemeMode): Promise<void> {
    await persistSettings(cloneSettings({ theme }));
  }

  async function setLanguage(language: LanguageMode): Promise<void> {
    await persistSettings(cloneSettings({ language }));
  }

  async function setMiniOpacity(value: string): Promise<void> {
    const parsed = Number(value);
    const opacity = Math.min(1, Math.max(0.35, Number.isFinite(parsed) ? parsed / 100 : 1));
    const miniNote = { ...settings.miniNote, opacity };
    const nextSettings = cloneSettings({ miniNote });
    settings = nextSettings;
    applyTheme(settings.theme);
    if (isTauriRuntime) {
      void saveSettings(nextSettings).catch(setError);
    }
    if (isTauriRuntime && !isMiniWindow) {
      await broadcastMiniNoteSettings(miniNote);
    }
  }

  async function setMiniBackgroundColor(color: string): Promise<void> {
    const miniNote = { ...settings.miniNote, backgroundColor: normalizeColor(color) };
    const nextSettings = cloneSettings({ miniNote });
    settings = nextSettings;
    applyTheme(settings.theme);
    if (isTauriRuntime) {
      void saveSettings(nextSettings).catch(setError);
    }
    if (isTauriRuntime && !isMiniWindow) {
      await broadcastMiniNoteSettings(miniNote);
    }
  }

  async function setMiniBackgroundChannel(channel: RgbChannel, value: string): Promise<void> {
    await setMiniBackgroundColor(
      rgbValueToColor({
        ...miniBackgroundChannels,
        [channel]: clampColorChannel(value),
      }),
    );
  }

  async function pickMiniBackgroundFromScreen(): Promise<void> {
    const EyeDropper = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (!EyeDropper) {
      return;
    }
    try {
      const result = await new EyeDropper().open();
      await setMiniBackgroundColor(result.sRGBHex);
    } catch {
      // The user can cancel screen picking.
    }
  }

  async function setMiniBackgroundHue(value: string): Promise<void> {
    await setMiniBackgroundColor(
      hsvToColor({
        ...colorToHsv(settings.miniNote.backgroundColor),
        h: clampHue(value),
      }),
    );
  }

  async function setMiniBackgroundSv(event: PointerEvent): Promise<void> {
    if (event.type === 'pointermove' && event.buttons !== 1) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    const box = target.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    const hsv = colorToHsv(settings.miniNote.backgroundColor);
    await setMiniBackgroundColor(hsvToColor({ h: hsv.h, s: x, v: 1 - y }));
  }

  async function toggleDailyFile(): Promise<void> {
    await flushSave();
    await persistSettings(cloneSettings({ dailyFile: { ...settings.dailyFile, enabled: !settings.dailyFile.enabled } }));
    if (settings.workspaceRoot) {
      await openWorkspace(settings.workspaceRoot);
    }
  }

  async function toggleTopmost(): Promise<void> {
    const next = !settings.window.alwaysOnTop;
    try {
      await setAlwaysOnTop(next);
      await persistSettings(cloneSettings({ window: { ...settings.window, alwaysOnTop: next } }));
    } catch (error) {
      setError(error);
    }
  }

  async function enterMiniMode(): Promise<void> {
    if (isTauriRuntime) {
      if (!settings.activeFilePath) {
        return;
      }
      await flushSave();
      try {
        await openMiniNoteWindow(settings.activeFilePath);
      } catch (error) {
        setError(error);
      }
      return;
    }

    if (transitionMode !== 'main') {
      return;
    }
    await flushSave();
    sourceMode = false;
    sidebarOpen = false;
    showSettings = false;
    transitionMode = 'to-mini';
    await tick();

    await delay(transitionDuration());
    miniMode = true;
    transitionMode = 'mini';
  }

  async function openFileAsMiniNote(path: string, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    await flushSave();
    try {
      if (isTauriRuntime) {
        await openMiniNoteWindow(path);
        return;
      }
      await switchFile(path);
      await enterMiniMode();
    } catch (error) {
      setError(error);
    }
  }

  async function openCurrentFileInMain(): Promise<void> {
    if (!settings.activeFilePath) {
      return;
    }
    await flushSave();
    if (isTauriRuntime && isMiniWindow) {
      try {
        await openFileInMain(settings.activeFilePath);
      } catch (error) {
        setError(error);
      }
      return;
    }
    await exitMiniMode();
  }

  async function closeCurrentMiniNote(): Promise<void> {
    await flushSave();
    if (isTauriRuntime && isMiniWindow) {
      try {
        await closeWindow();
      } catch (error) {
        setError(error);
      }
      return;
    }
    await exitMiniMode();
  }

  async function exitMiniMode(): Promise<void> {
    if (transitionMode !== 'mini') {
      return;
    }
    transitionMode = 'to-main';
    await tick();

    await delay(transitionDuration());
    miniMode = false;
    await tick();
    await delay(prefersReducedMotion() ? 0 : MAIN_ENTER_SETTLE_MS);
    transitionMode = 'main';
  }

  async function toggleAutostart(): Promise<void> {
    try {
      const enabled = await configureAutostart(!settings.autoStart);
      await persistSettings(cloneSettings({ autoStart: enabled }));
    } catch (error) {
      setError(error);
    }
  }

  function updateContent(next: string): void {
    content = next;
    scheduleSave();
    if (!applyingRemoteContent && isTauriRuntime && settings.activeFilePath) {
      void broadcastMiniNoteContent(settings.activeFilePath, next);
    }
  }

  function insertMarkdown(markdown: string): void {
    const text = `\n\n${markdown}\n`;
    if (sourceMode && sourceEditor) {
      sourceEditor.insertText(text);
    } else if (richEditor) {
      richEditor.insertMarkdown(markdown);
    } else {
      content = `${content.trimEnd()}${text}`;
      scheduleSave();
    }
  }

  async function insertTaskCheckbox(): Promise<void> {
    if (sourceMode && sourceEditor) {
      sourceEditor.toggleTaskMarkerAtLineStart();
    } else if (richEditor) {
      const target = richEditor.getTaskToggleTarget(content);
      pendingNavigationAnchor = { kind: 'cursor', anchor: richEditor.getSourceLineAnchor(target.editorLine) };
      updateContent(toggleTaskMarkerOnLine(content, target.documentLine, { preserveEmptyParagraph: true }));
      await tick();
      restorePendingNavigation();
    } else {
      updateContent(toggleTaskMarkerOnLine(content, 1));
    }
  }

  function currentTimestampLabel(): string {
    const now = new Date();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${minutes}`;
  }

  function insertCurrentTime(): void {
    const timestamp = currentTimestampLabel();
    const markdown = `<span data-topplan-time="${timestamp}">${timestamp}</span>`;
    if (sourceMode && sourceEditor) {
      sourceEditor.insertText(` ${markdown} `);
    } else if (richEditor) {
      richEditor.insertTimestamp(timestamp);
    } else {
      const separator = content && !content.endsWith('\n') && !content.endsWith(' ') ? ' ' : '';
      content = `${content}${separator}${markdown} `;
      scheduleSave();
    }
  }

  function extensionFromMime(type: string): string {
    if (type.includes('jpeg')) return 'jpg';
    if (type.includes('gif')) return 'gif';
    if (type.includes('webp')) return 'webp';
    return 'png';
  }

  async function handlePaste(event: ClipboardEvent): Promise<boolean> {
    if (event.defaultPrevented || !settings.activeFilePath || !event.clipboardData) {
      return false;
    }
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
    if (!imageItem) {
      return false;
    }

    event.preventDefault();
    try {
      const file = imageItem.getAsFile();
      if (!file) {
        return false;
      }
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const relativePath = await savePastedImage(settings.activeFilePath, bytes, extensionFromMime(file.type));
      if (sourceMode && sourceEditor) {
        sourceEditor.insertText(`\n\n![](${relativePath})\n`);
      } else if (richEditor) {
        richEditor.insertImage(relativePath);
      } else {
        insertMarkdown(`![](${relativePath})`);
      }
      await tick();
      await flushSave();
      await refreshImages();
      return true;
    } catch (error) {
      setError(error);
    }
    return true;
  }

  function currentNavigationAnchor(): NavigationAnchor {
    if (sourceMode) {
      const cursor = sourceEditor?.getCursorAnchor();
      return cursor && cursor.yOffset >= -CURSOR_ANCHOR_VIEWPORT_TOLERANCE && cursor.yOffset <= window.innerHeight
        ? { kind: 'cursor', anchor: cursor }
        : { kind: 'top', line: sourceEditor?.getTopLine() ?? 1 };
    }
    const cursor = richEditor?.getCursorAnchor();
    return cursor && cursor.yOffset >= -CURSOR_ANCHOR_VIEWPORT_TOLERANCE && cursor.yOffset <= window.innerHeight
      ? { kind: 'cursor', anchor: cursor }
      : { kind: 'top', line: richEditor?.getTopLine() ?? 1 };
  }

  function restoreNavigationAnchor(anchor: NavigationAnchor): boolean {
    try {
      return (
        anchor.kind === 'cursor'
          ? sourceMode
            ? (sourceEditor?.setCursorAnchor(anchor.anchor) ?? false)
            : (richEditor?.setCursorAnchor(anchor.anchor) ?? false)
          : sourceMode
            ? (sourceEditor?.scrollToLine(anchor.line) ?? false)
            : (richEditor?.scrollToLine(anchor.line) ?? false)
      );
    } catch (error) {
      return false;
    }
  }

  function restorePendingNavigation(): void {
    if (!pendingNavigationAnchor) {
      return;
    }
    if (restoreNavigationAnchor(pendingNavigationAnchor)) {
      pendingNavigationAnchor = null;
    }
  }

  async function toggleSourceMode(): Promise<void> {
    const anchor = currentNavigationAnchor();
    pendingNavigationAnchor = anchor;
    sourceMode = !sourceMode;
    await tick();
    restorePendingNavigation();
  }

  async function handleTitlePointerDown(event: PointerEvent): Promise<void> {
    if (event.button !== 0 || !isTauriRuntime) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, select, textarea, a, .document-title')) {
      return;
    }
    try {
      await startWindowDrag();
    } catch {
      // The native data-tauri-drag-region attribute remains as fallback.
    }
  }

  function revealScrollbars(): void {
    scrollVisible = true;
    if (scrollTimer) {
      clearTimeout(scrollTimer);
    }
    scrollTimer = setTimeout(() => {
      scrollVisible = false;
    }, 3000);
  }

  function closeTransientPanels(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (target.closest('.file-sidebar, .settings-popover, .sidebar-toggle, .settings-toggle, .app-menu-toggle')) {
      return;
    }
    if (sidebarOpen) {
      sidebarOpen = false;
    }
    if (showSettings) {
      showSettings = false;
    }
  }

  function handleWheel(event: WheelEvent): void {
    revealScrollbars();
    if (!event.ctrlKey || miniMode) {
      return;
    }
    event.preventDefault();
    const now = Date.now();
    if (now - lastZoomWheelAt < 80) {
      return;
    }
    lastZoomWheelAt = now;
    const direction = event.deltaY < 0 ? 1 : -1;
    const nearestIndex = ZOOM_STEPS.reduce((bestIndex, step, index) => {
      return Math.abs(step - zoom) < Math.abs(ZOOM_STEPS[bestIndex] - zoom) ? index : bestIndex;
    }, 0);
    const nextIndex = Math.min(ZOOM_STEPS.length - 1, Math.max(0, nearestIndex + direction));
    zoom = ZOOM_STEPS[nextIndex];
    zoomVisible = true;
    if (zoomTimer) {
      clearTimeout(zoomTimer);
    }
    zoomTimer = setTimeout(() => {
      zoomVisible = false;
    }, 1200);
  }

  async function handleMiniPointerDown(event: PointerEvent, action: 'move' | 'resize', direction?: Parameters<typeof startWindowResize>[0]): Promise<void> {
    if (event.button !== 0 || !isTauriRuntime) {
      return;
    }
    try {
      if (action === 'move') {
        await startWindowDrag();
      } else if (direction) {
        await startWindowResize(direction);
      }
    } catch {
      // Native dragging can fail in browser preview; no fallback needed.
    }
  }

  function applyRemoteContent(path: string, nextContent: string): void {
    if (path !== settings.activeFilePath || nextContent === content) {
      return;
    }
    applyingRemoteContent = true;
    content = nextContent;
    dirty = false;
    applyingRemoteContent = false;
  }

  async function loadApp(): Promise<void> {
    applyTheme(settings.theme);

    if (!isTauriRuntime) {
      loading = false;
      desktopPreview = true;
      return;
    }

    try {
      settings = await getSettings();
      applyTheme(settings.theme);
      if (isMiniWindow) {
        if (!launchedMiniFilePath) {
          throw new Error('Mini note file path is missing.');
        }
        settings = cloneSettings({ activeFilePath: launchedMiniFilePath });
        content = await readMarkdownFile(launchedMiniFilePath);
        dirty = false;
        sourceMode = false;
        sidebarOpen = false;
        showSettings = false;
        miniMode = true;
        transitionMode = 'mini';
        await setAlwaysOnTop(true);
        await setWindowShadow(false);
        await setWindowSizeLimits(210, 180, 390, 560);
        return;
      }
      await setAlwaysOnTop(settings.window.alwaysOnTop);
      await configureGlobalHotkey(settings.hotkey, (event) => {
        if (event.state !== 'Pressed') {
          return;
        }
        const now = Date.now();
        if (now - lastHotkeyToggleAt < 700) {
          return;
        }
        lastHotkeyToggleAt = now;
        void toggleAppWindows();
      });
      if (settings.workspaceRoot) {
        await openWorkspace(settings.workspaceRoot);
      }
    } catch (error) {
      setError(error);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (import.meta.env.DEV) {
      const testWindow = window as Window & { __TOPPLAN_TEST__?: TopPlanTestApi };
      testWindow.__TOPPLAN_TEST__ = {
        async setDocument(markdown: string) {
          const path = '__topplan_test__/test.md';
          settings = cloneSettings({ workspaceRoot: '__topplan_test__', activeFilePath: path });
          files = [{ name: 'test.md', path, modifiedAt: new Date(0).toISOString(), size: markdown.length, isActive: true }];
          images = [];
          content = markdown;
          dirty = false;
          loading = false;
          desktopPreview = false;
          sourceMode = false;
          await tick();
        },
        getContent() {
          return content;
        },
        getRichDebugSnapshot() {
          return richEditor?.getDebugSnapshot() ?? null;
        },
      };
    }

    void loadApp();
    let unlistenOpenFile: (() => void) | null = null;
    let unlistenMiniSettings: (() => void) | null = null;
    let unlistenMiniContent: (() => void) | null = null;
    if (isTauriRuntime && !isMiniWindow) {
      void onOpenFileInMain(async (path) => {
        await openFileInMainView(path);
      }).then((unlisten) => {
        unlistenOpenFile = unlisten;
      });
    }
    if (isTauriRuntime && isMiniWindow) {
      void onMiniNoteSettingsChanged((miniNote) => {
        settings = cloneSettings({ miniNote });
      }).then((unlisten) => {
        unlistenMiniSettings = unlisten;
      });
    }
    if (isTauriRuntime) {
      void onMiniNoteContentChanged((payload) => {
        applyRemoteContent(payload.path, payload.content);
      }).then((unlisten) => {
        unlistenMiniContent = unlisten;
      });
    }

    const beforeUnload = () => {
      void flushSave();
    };
    const pasteListener = (event: ClipboardEvent) => {
      void handlePaste(event);
    };
    const wheelListener = (event: WheelEvent) => {
      handleWheel(event);
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('paste', pasteListener);
    window.addEventListener('wheel', wheelListener, { capture: true, passive: false });
    return () => {
      if (import.meta.env.DEV) {
        const testWindow = window as Window & { __TOPPLAN_TEST__?: TopPlanTestApi };
        delete testWindow.__TOPPLAN_TEST__;
      }
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('paste', pasteListener);
      window.removeEventListener('wheel', wheelListener, { capture: true });
      unlistenOpenFile?.();
      unlistenMiniSettings?.();
      unlistenMiniContent?.();
      if (scrollTimer) {
        clearTimeout(scrollTimer);
      }
      if (zoomTimer) {
        clearTimeout(zoomTimer);
      }
    };
  });
</script>

<main
  class:mini-mode={miniMode}
  class:scroll-visible={scrollVisible}
  class:to-mini={transitionMode === 'to-mini'}
  class:to-main={transitionMode === 'to-main'}
  class="app-shell"
  style={`--mini-opacity: ${miniSurfaceOpacity}; --mini-slider-opacity: ${settings.miniNote.opacity}; --mini-bg-rgb: ${miniBackgroundRgb}`}
  onpointerdown={closeTransientPanels}
  onmousemove={revealScrollbars}
>
  {#if miniMode}
    <div class="mini-note-shell" role="group" aria-label="TopPlan mini note mode">
      <button class="mini-exit" title={isMiniWindow ? text.openInMain : text.exitMiniMode} onclick={openCurrentFileInMain}>
        <Maximize2 size={11} />
      </button>
      {#if isMiniWindow}
        <button class="mini-close" title={text.closeMiniNote} onclick={closeCurrentMiniNote}>
          <X size={12} />
        </button>
      {/if}
      <button class="mini-move-zone" title={text.moveMiniMode} onpointerdown={(event) => handleMiniPointerDown(event, 'move')}></button>
      <button class="mini-resize-zone mini-resize-n" aria-label="Resize north" onpointerdown={(event) => handleMiniPointerDown(event, 'resize', 'North')}></button>
      <button class="mini-resize-zone mini-resize-e" aria-label="Resize east" onpointerdown={(event) => handleMiniPointerDown(event, 'resize', 'East')}></button>
      <button class="mini-resize-zone mini-resize-s" aria-label="Resize south" onpointerdown={(event) => handleMiniPointerDown(event, 'resize', 'South')}></button>
      <button class="mini-resize-zone mini-resize-w" aria-label="Resize west" onpointerdown={(event) => handleMiniPointerDown(event, 'resize', 'West')}></button>
      <button class="mini-resize-corner mini-resize-ne" aria-label="Resize north east" onpointerdown={(event) => handleMiniPointerDown(event, 'resize', 'NorthEast')}></button>
      <button class="mini-resize-corner mini-resize-se" aria-label="Resize south east" onpointerdown={(event) => handleMiniPointerDown(event, 'resize', 'SouthEast')}></button>
      <button class="mini-resize-corner mini-resize-sw" aria-label="Resize south west" onpointerdown={(event) => handleMiniPointerDown(event, 'resize', 'SouthWest')}></button>
      <button class="mini-resize-corner mini-resize-nw" aria-label="Resize north west" onpointerdown={(event) => handleMiniPointerDown(event, 'resize', 'NorthWest')}></button>
      <MiniNoteView value={content} onChange={updateContent} />
    </div>
  {:else}
  <header class="titlebar" role="toolbar" aria-label="TopPlan window controls" tabindex="-1" data-tauri-drag-region onpointerdown={handleTitlePointerDown}>
    <div class="identity" data-tauri-drag-region>
      <button class:active={sidebarOpen} class="mark app-menu-toggle" title={sidebarOpen ? text.hideSidebar : text.showSidebar} onclick={() => (sidebarOpen = !sidebarOpen)}>
        <img src="/topplan-icon-title.png" alt="" />
      </button>
      <div class="identity-copy" data-tauri-drag-region>
        <h1 data-tauri-drag-region>TopPlan</h1>
        {#if renamingTitle}
          <input
            bind:this={titleInput}
            bind:value={titleDraft}
            class="title-rename-input document-title"
            aria-label={text.renameFile}
            onblur={commitTitleRename}
            onkeydown={handleTitleRenameKeydown}
          />
        {:else}
          <button class="document-title" title={text.renameFileHint} ondblclick={startTitleRename}>
            {activeFile?.name ?? text.subtitle}
          </button>
        {/if}
      </div>
    </div>

    <div class="window-actions">
      <button class="icon-button" title={text.enterMiniMode} onclick={enterMiniMode}>
        <NotepadText size={14} />
      </button>
      <button class="icon-button" title={text.refreshImageIndex} onclick={refreshImages}>
        <RefreshCw size={14} />
      </button>
      <button class="icon-button settings-toggle" title={text.settings} onclick={() => (showSettings = !showSettings)}>
        <Settings size={14} />
      </button>
      <button class="icon-button" title={settings.window.alwaysOnTop ? text.disableTopmost : text.enableTopmost} onclick={toggleTopmost}>
        {#if settings.window.alwaysOnTop}
          <Pin size={14} />
        {:else}
          <PinOff size={14} />
        {/if}
      </button>
      <button class="icon-button" title={text.minimizeWindow} onclick={minimizeWindow}>
        <Minus size={14} />
      </button>
      <button class="icon-button" title={text.hideWindow} onclick={hideWindow}>
        <SquareChevronDown size={14} />
      </button>
    </div>
  </header>

  {#if errorMessage || desktopPreview}
    <section class="notice">
      <TriangleAlert size={15} />
      <span>{errorMessage || text.desktopOnly}</span>
    </section>
  {/if}

  {#if loading}
    <section class="empty-state">
      <RefreshCw size={22} />
      <h2>{text.loadingWorkspace}</h2>
    </section>
  {:else if !settings.workspaceRoot}
    <section class="empty-state">
      <FolderOpen size={30} />
      <h2>{text.selectDataFolder}</h2>
      <p>{text.selectDataFolderHint}</p>
      <button class="primary-button" onclick={chooseWorkspace}>
        <FolderOpen size={16} />
        {text.selectFolder}
      </button>
    </section>
  {:else}
    <section class:sidebar-open={sidebarOpen} class="workspace-main">
      {#if sidebarOpen}
        <aside class="file-sidebar">
          <div class="file-create">
            <input bind:value={newFileName} placeholder={text.newFile} aria-label={text.newFileAria} />
            <button class="icon-button" title={text.createFile} onclick={createFile}>
              <FilePlus size={15} />
            </button>
          </div>
          <div class="file-list">
            {#each files as file}
              <div class:active={file.path === settings.activeFilePath} class="file-list-item" title={file.path}>
                <button class="file-item-main" onclick={() => switchFile(file.path)}>
                  <FileText size={14} />
                  <span>{file.name}</span>
                </button>
                <button class="file-mini-button" title={text.openMiniNote} onclick={(event) => openFileAsMiniNote(file.path, event)}>
                  <NotepadText size={13} />
                </button>
              </div>
            {/each}
          </div>
        </aside>
      {/if}

      <section class="document-surface" onscroll={revealScrollbars}>
        {#if sourceMode}
          <CodeMirrorEditor
            bind:this={sourceEditor}
            value={content}
            activeFilePath={settings.activeFilePath}
            {zoom}
            onChange={updateContent}
            onReady={restorePendingNavigation}
          />
        {:else}
          <RichMarkdownEditor
            bind:this={richEditor}
            value={content}
            {images}
            activeFilePath={settings.activeFilePath}
            {zoom}
            onChange={updateContent}
            onPasteImage={handlePaste}
            onReady={restorePendingNavigation}
          />
        {/if}
      </section>
    </section>

    <footer class="bottom-bar">
      <div class="bottom-left">
        <button class:active={sidebarOpen} class="bottom-icon sidebar-toggle" title={sidebarOpen ? text.hideSidebar : text.showSidebar} onclick={() => (sidebarOpen = !sidebarOpen)}>
          {#if sidebarOpen}
            <PanelLeftClose size={15} />
          {:else}
            <PanelLeftOpen size={15} />
          {/if}
        </button>
        <button class:active={sourceMode} class="bottom-icon" title={sourceMode ? text.readingMode : text.sourceMode} onclick={toggleSourceMode}>
          <Code2 size={15} />
        </button>
        <button class="bottom-icon" title={text.insertTask} onclick={insertTaskCheckbox}>
          <SquarePlus size={15} />
        </button>
        <button class="bottom-icon" title={text.insertCurrentTime} onclick={insertCurrentTime}>
          <Clock3 size={15} />
        </button>
      </div>

      <div class="bottom-status">
        <span class:dirty>{saving ? text.saving : dirty ? text.unsaved : text.saved}</span>
        <span><Image size={13} /> {images.length}</span>
        {#if missingImages.length > 0}
          <span class="warn"><TriangleAlert size={13} /> {missingImages.length}</span>
        {/if}
        {#if externalImages.length > 0}
          <span>{externalImages.length} {text.external}</span>
        {/if}
        <span>{wordCount} {text.words}</span>
      </div>
    </footer>

    {#if zoomVisible}
      <div class="zoom-popover">{Math.round(zoom * 100)}%</div>
    {/if}

    {#if showSettings}
      <aside class:mini-color-picker-open={showMiniColorPicker} class="settings-popover">
        <div class="settings-head">
          <h2>{text.settings}</h2>
          <button class="icon-button" title={text.closeSettings} onclick={() => (showSettings = false)}>
            <X size={14} />
          </button>
        </div>

        <button class="setting-command" onclick={chooseWorkspace}>
          <FolderOpen size={15} />
          <span>{text.chooseAnotherFolder}</span>
        </button>

        <label class="setting-row">
          <span>{text.dailyFile}</span>
          <input type="checkbox" checked={settings.dailyFile.enabled} onchange={toggleDailyFile} />
        </label>

        <label class="setting-row">
          <span>{text.autostart}</span>
          <input type="checkbox" checked={settings.autoStart} onchange={toggleAutostart} />
        </label>

        <label class="setting-row">
          <span>{text.hotkey}</span>
          <input value={settings.hotkey} readonly />
        </label>

        <div class="setting-label">{text.language}</div>
        <div class="segmented-row language-row">
          <button class:active={settings.language === 'zh'} onclick={() => setLanguage('zh')}>中文</button>
          <button class:active={settings.language === 'en'} onclick={() => setLanguage('en')}>English</button>
        </div>

        <div class="setting-label">{text.theme}</div>
        <div class="segmented-row theme-row">
          <button class:active={settings.theme === 'system'} onclick={() => setTheme('system')}>{text.system}</button>
          <button class:active={settings.theme === 'light'} onclick={() => setTheme('light')}>{text.light}</button>
          <button class:active={settings.theme === 'dark'} onclick={() => setTheme('dark')}>{text.dark}</button>
        </div>

        <div class="setting-row mini-opacity-row">
          <span>{text.miniOpacity}</span>
          <strong>{Math.round(settings.miniNote.opacity * 100)}%</strong>
        </div>
        <input
          class="setting-slider"
          type="range"
          min="35"
          max="100"
          step="5"
          value={Math.round(settings.miniNote.opacity * 100)}
          aria-label={text.miniOpacity}
          oninput={(event) => setMiniOpacity(event.currentTarget.value)}
        />

        <div class="setting-row mini-background-heading">
          <span>{text.miniBackground}</span>
        </div>
        <div class="mini-color-presets" aria-label={text.miniBackground}>
          {#each MINI_BACKGROUND_PRESETS as color}
            <button
              class:active={settings.miniNote.backgroundColor === color}
              class="mini-color-preset"
              style={`--preset-color: ${color}`}
              title={color}
              aria-label={`${text.miniBackground} ${color}`}
              onclick={() => {
                showMiniColorPicker = false;
                void setMiniBackgroundColor(color);
              }}
            ></button>
          {/each}
          <button
            class:active={customMiniBackgroundSelected}
            class="mini-color-custom"
            title={text.miniCustomColor}
            aria-label={text.miniCustomColor}
            aria-expanded={showMiniColorPicker}
            onclick={() => (showMiniColorPicker = !showMiniColorPicker)}
          >
          </button>
        </div>
        {#if showMiniColorPicker}
          <div class="mini-color-popover" role="dialog" aria-label={text.miniCustomColor}>
            <button
              class="mini-color-field"
              style={`--picker-hue-color: ${miniBackgroundHueColor}; --picker-cursor-x: ${miniBackgroundHsv.s * 100}%; --picker-cursor-y: ${(1 - miniBackgroundHsv.v) * 100}%`}
              aria-label={text.miniCustomColor}
              onpointerdown={(event) => setMiniBackgroundSv(event)}
              onpointermove={(event) => setMiniBackgroundSv(event)}
            >
              <span class="mini-color-field-cursor"></span>
            </button>
            <div class="mini-color-controls">
              <button
                class="mini-color-eyedropper"
                title={text.miniCustomColor}
                aria-label={text.miniCustomColor}
                disabled={!miniColorEyeDropperAvailable}
                onclick={pickMiniBackgroundFromScreen}
              >
                <Pipette size={16} />
              </button>
              <span class="mini-color-preview" style={`--custom-color: ${settings.miniNote.backgroundColor}`}></span>
              <input
                class="mini-color-hue"
                type="range"
                min="0"
                max="359"
                step="1"
                value={miniBackgroundHsv.h}
                aria-label={`${text.miniCustomColor} hue`}
                oninput={(event) => setMiniBackgroundHue(event.currentTarget.value)}
              />
            </div>
            <div class="mini-color-rgb-row">
              {#each MINI_COLOR_CHANNELS as channel}
                <label class="mini-color-channel">
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={miniBackgroundChannels[channel.key]}
                    aria-label={`${text.miniCustomColor} ${channel.label}`}
                    oninput={(event) => setMiniBackgroundChannel(channel.key, event.currentTarget.value)}
                  />
                  <span>{channel.label}</span>
                </label>
              {/each}
            </div>
          </div>
        {/if}
      </aside>
    {/if}
  {/if}
  {/if}
</main>
