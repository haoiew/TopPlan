<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Clock,
    Columns2,
    Eye,
    FilePlus,
    FileText,
    FolderOpen,
    Image,
    Minimize2,
    Pencil,
    Pin,
    PinOff,
    RefreshCw,
    Save,
    Settings,
    TriangleAlert,
  } from '@lucide/svelte';
  import CodeMirrorEditor from './lib/CodeMirrorEditor.svelte';
  import { AUTOSAVE_DELAY_MS, DEFAULT_FILE_NAME, DEFAULT_MARKDOWN, DEFAULT_SETTINGS, interruptionTemplate, todayFileName } from './lib/defaults';
  import { renderMarkdown } from './lib/markdown';
  import {
    configureAutostart,
    configureGlobalHotkey,
    createMarkdownFile,
    getSettings,
    hideWindow,
    isTauriRuntime,
    listMarkdownFiles,
    readMarkdownFile,
    saveSettings,
    scanImageReferences,
    selectWorkspaceDir,
    setAlwaysOnTop,
    toggleMainWindow,
    writeMarkdownFile,
  } from './lib/tauriClient';
  import { TEXT } from './lib/i18n';
  import type { AppSettings, ImageReference, LanguageMode, PlanFile, ThemeMode, ViewMode } from './types';

  let settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  let files: PlanFile[] = [];
  let images: ImageReference[] = [];
  let content = '';
  let viewMode: ViewMode = 'edit';
  let loading = true;
  let saving = false;
  let dirty = false;
  let showSettings = false;
  let desktopPreview = false;
  let errorMessage = '';
  let newFileName = '';
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  $: activeFile = files.find((file) => file.path === settings.activeFilePath) ?? null;
  $: missingImages = images.filter((item) => item.status === 'missing');
  $: externalImages = images.filter((item) => item.status === 'external');
  $: rendered = renderMarkdown(content, settings.activeFilePath, images);
  $: text = TEXT[settings.language] ?? TEXT.zh;

  function cloneSettings(next: Partial<AppSettings>): AppSettings {
    return {
      ...settings,
      ...next,
      window: { ...settings.window, ...(next.window ?? {}) },
      dailyFile: { ...settings.dailyFile, ...(next.dailyFile ?? {}) },
    };
  }

  function applyTheme(theme: ThemeMode): void {
    document.documentElement.dataset.theme = theme;
  }

  function setError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : String(error);
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
      dirty = false;
      await refreshFiles();
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
    images = await scanImageReferences(settings.workspaceRoot);
  }

  async function ensureActiveFile(root: string): Promise<string> {
    let currentFiles = await listMarkdownFiles(root, settings.activeFilePath);

    if (settings.dailyFile.enabled) {
      const name = todayFileName();
      const existing = currentFiles.find((file) => file.name === name);
      if (existing) {
        return existing.path;
      }
      const created = await createMarkdownFile(root, name, DEFAULT_MARKDOWN);
      return created.path;
    }

    if (settings.activeFilePath && currentFiles.some((file) => file.path === settings.activeFilePath)) {
      return settings.activeFilePath;
    }

    if (currentFiles.length > 0) {
      return currentFiles[0].path;
    }

    const created = await createMarkdownFile(root, DEFAULT_FILE_NAME, DEFAULT_MARKDOWN);
    return created.path;
  }

  async function openWorkspace(root: string): Promise<void> {
    loading = true;
    errorMessage = '';
    try {
      const activePath = await ensureActiveFile(root);
      settings = cloneSettings({ workspaceRoot: root, activeFilePath: activePath });
      content = await readMarkdownFile(activePath);
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
      content = await readMarkdownFile(path);
      dirty = false;
      await persistSettings(cloneSettings({ activeFilePath: path }));
      await refreshFiles();
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
      content = await readMarkdownFile(created.path);
      dirty = false;
      await persistSettings(cloneSettings({ activeFilePath: created.path }));
      await refreshFiles();
      await refreshImages();
    } catch (error) {
      setError(error);
    }
  }

  async function setTheme(theme: ThemeMode): Promise<void> {
    await persistSettings(cloneSettings({ theme }));
  }

  async function setLanguage(language: LanguageMode): Promise<void> {
    await persistSettings(cloneSettings({ language }));
  }

  async function toggleLanguage(): Promise<void> {
    await setLanguage(settings.language === 'zh' ? 'en' : 'zh');
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

  async function toggleAutostart(): Promise<void> {
    try {
      const enabled = await configureAutostart(!settings.autoStart);
      await persistSettings(cloneSettings({ autoStart: enabled }));
    } catch (error) {
      setError(error);
    }
  }

  function insertInterruptedTask(): void {
    content = `${content.trimEnd()}\n${interruptionTemplate()}`;
    scheduleSave();
  }

  async function loadApp(): Promise<void> {
    if (!isTauriRuntime) {
      loading = false;
      desktopPreview = true;
      return;
    }

    try {
      settings = await getSettings();
      applyTheme(settings.theme);
      await setAlwaysOnTop(settings.window.alwaysOnTop);
      await configureGlobalHotkey(settings.hotkey, () => {
        void toggleMainWindow();
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

  function updateContent(next: string): void {
    content = next;
    scheduleSave();
  }

  onMount(() => {
    void loadApp();

    const beforeUnload = () => {
      if (settings.activeFilePath && dirty) {
        void flushSave();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  });
</script>

<main class="app-shell">
  <header class="titlebar" data-tauri-drag-region>
    <div class="identity">
      <div class="mark">TP</div>
      <div>
        <h1>TopPlan</h1>
        <p>{activeFile?.name ?? text.subtitle}</p>
      </div>
    </div>

    <div class="window-actions">
      <button class="language-button" title={settings.language === 'zh' ? text.switchToEnglish : text.switchToChinese} onclick={toggleLanguage}>
        {settings.language === 'zh' ? 'EN' : '中'}
      </button>
      <button class="icon-button" title={settings.window.alwaysOnTop ? text.disableTopmost : text.enableTopmost} onclick={toggleTopmost}>
        {#if settings.window.alwaysOnTop}
          <Pin size={17} />
        {:else}
          <PinOff size={17} />
        {/if}
      </button>
      <button class="icon-button" title={text.hideWindow} onclick={hideWindow}>
        <Minimize2 size={17} />
      </button>
    </div>
  </header>

  {#if errorMessage || desktopPreview}
    <section class="notice">
      <TriangleAlert size={16} />
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
        <FolderOpen size={17} />
        {text.selectFolder}
      </button>
    </section>
  {:else}
    <section class="workspace-bar">
      <button class="path-button" onclick={chooseWorkspace} title={settings.workspaceRoot}>
        <FolderOpen size={15} />
        <span>{settings.workspaceRoot}</span>
      </button>
      <div class="save-state" class:dirty>
        <Save size={14} />
        {saving ? text.saving : dirty ? text.unsaved : text.saved}
      </div>
    </section>

    <section class="toolbar">
      <div class="segmented" aria-label="View mode">
        <button class:active={viewMode === 'edit'} title={text.edit} onclick={() => (viewMode = 'edit')}>
          <Pencil size={16} />
        </button>
        <button class:active={viewMode === 'preview'} title={text.preview} onclick={() => (viewMode = 'preview')}>
          <Eye size={16} />
        </button>
        <button class:active={viewMode === 'split'} title={text.splitView} onclick={() => (viewMode = 'split')}>
          <Columns2 size={16} />
        </button>
      </div>
      <button class="tool-button" onclick={insertInterruptedTask}>
        <Clock size={16} />
        {text.interrupted}
      </button>
      <button class="icon-button" title={text.refreshImageIndex} onclick={refreshImages}>
        <RefreshCw size={16} />
      </button>
      <button class="icon-button" title={text.settings} onclick={() => (showSettings = !showSettings)}>
        <Settings size={16} />
      </button>
    </section>

    <section class="content-layout">
      <aside class="file-rail">
        <div class="file-create">
          <input bind:value={newFileName} placeholder={text.newFile} aria-label={text.newFileAria} />
          <button class="icon-button" title={text.createFile} onclick={createFile}>
            <FilePlus size={16} />
          </button>
        </div>
        <div class="file-list">
          {#each files as file}
            <button class:active={file.path === settings.activeFilePath} onclick={() => switchFile(file.path)} title={file.path}>
              <FileText size={15} />
              <span>{file.name}</span>
            </button>
          {/each}
        </div>
      </aside>

      <section class:split-pane={viewMode === 'split'} class="editor-area">
        {#if viewMode === 'edit' || viewMode === 'split'}
          <div class="pane editor-pane">
            <CodeMirrorEditor value={content} onChange={updateContent} />
          </div>
        {/if}
        {#if viewMode === 'preview' || viewMode === 'split'}
          <article class="pane preview-pane">
            {@html rendered}
          </article>
        {/if}
      </section>
    </section>

    <section class="status-dock">
      <div class="status-item">
        <Image size={14} />
        {images.length} {text.images}
      </div>
      <div class:warn={missingImages.length > 0} class="status-item">
        <TriangleAlert size={14} />
        {missingImages.length} {text.missing}
      </div>
      <div class="status-item">{externalImages.length} {text.external}</div>
    </section>

    {#if showSettings}
      <aside class="settings-panel">
        <div class="settings-head">
          <h2>{text.settings}</h2>
          <button class="icon-button" title={text.closeSettings} onclick={() => (showSettings = false)}>×</button>
        </div>

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

        <label class="setting-row">
          <span>{text.language}</span>
          <select value={settings.language} onchange={(event) => setLanguage(event.currentTarget.value as LanguageMode)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>

        <div class="setting-label">{text.theme}</div>
        <div class="theme-row">
          <button class:active={settings.theme === 'system'} onclick={() => setTheme('system')}>{text.system}</button>
          <button class:active={settings.theme === 'light'} onclick={() => setTheme('light')}>{text.light}</button>
          <button class:active={settings.theme === 'dark'} onclick={() => setTheme('dark')}>{text.dark}</button>
        </div>
      </aside>
    {/if}
  {/if}
</main>
