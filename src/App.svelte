<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    Clock,
    Code2,
    FilePlus,
    FileText,
    FolderOpen,
    Image,
    Languages,
    Minus,
    PanelLeftClose,
    PanelLeftOpen,
    Pin,
    PinOff,
    RefreshCw,
    Settings,
    SquareChevronDown,
    TriangleAlert,
    X,
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
    minimizeWindow,
    readMarkdownFile,
    savePastedImage,
    saveSettings,
    scanImageReferences,
    selectWorkspaceDir,
    setAlwaysOnTop,
    startWindowDrag,
    toggleMainWindow,
    writeMarkdownFile,
  } from './lib/tauriClient';
  import { TEXT } from './lib/i18n';
  import type { AppSettings, ImageReference, LanguageMode, PlanFile, ThemeMode } from './types';

  let settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  let files: PlanFile[] = [];
  let images: ImageReference[] = [];
  let content = '';
  let loading = true;
  let saving = false;
  let dirty = false;
  let sidebarOpen = false;
  let sourceMode = false;
  let showSettings = false;
  let desktopPreview = false;
  let errorMessage = '';
  let newFileName = '';
  let scrollVisible = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let sourceEditor: { insertText: (text: string) => void } | null = null;

  $: activeFile = files.find((file) => file.path === settings.activeFilePath) ?? null;
  $: missingImages = images.filter((item) => item.status === 'missing');
  $: externalImages = images.filter((item) => item.status === 'external');
  $: rendered = renderMarkdown(content, settings.activeFilePath, images);
  $: text = TEXT[settings.language] ?? TEXT.zh;
  $: wordCount = content.replace(/\s+/g, '').length;

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
      await refreshImages();
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
      sidebarOpen = true;
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

  function updateContent(next: string): void {
    content = next;
    scheduleSave();
  }

  function insertMarkdown(markdown: string): void {
    const text = `\n\n${markdown}\n`;
    if (sourceMode && sourceEditor) {
      sourceEditor.insertText(text);
    } else {
      content = `${content.trimEnd()}${text}`;
      scheduleSave();
    }
  }

  function insertInterruptedTask(): void {
    insertMarkdown(interruptionTemplate().trim());
  }

  function extensionFromMime(type: string): string {
    if (type.includes('jpeg')) return 'jpg';
    if (type.includes('gif')) return 'gif';
    if (type.includes('webp')) return 'webp';
    return 'png';
  }

  async function handlePaste(event: ClipboardEvent): Promise<void> {
    if (!settings.activeFilePath || !event.clipboardData) {
      return;
    }
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
    if (!imageItem) {
      return;
    }

    event.preventDefault();
    try {
      const file = imageItem.getAsFile();
      if (!file) {
        return;
      }
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const relativePath = await savePastedImage(settings.activeFilePath, bytes, extensionFromMime(file.type));
      insertMarkdown(`![](${relativePath})`);
      await tick();
      await flushSave();
      await refreshImages();
    } catch (error) {
      setError(error);
    }
  }

  async function toggleSourceMode(): Promise<void> {
    sourceMode = !sourceMode;
  }

  async function handleTitlePointerDown(event: PointerEvent): Promise<void> {
    if (event.button !== 0 || !isTauriRuntime) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, select, textarea, a')) {
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

  onMount(() => {
    void loadApp();

    const beforeUnload = () => {
      void flushSave();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('paste', handlePaste);
      if (scrollTimer) {
        clearTimeout(scrollTimer);
      }
    };
  });
</script>

<main class:scroll-visible={scrollVisible} class="app-shell" onmousemove={revealScrollbars} onwheel={revealScrollbars}>
  <header class="titlebar" role="toolbar" aria-label="TopPlan window controls" tabindex="-1" data-tauri-drag-region onpointerdown={handleTitlePointerDown}>
    <div class="identity" data-tauri-drag-region>
      <div class="mark" data-tauri-drag-region>TP</div>
      <div class="identity-copy" data-tauri-drag-region>
        <h1 data-tauri-drag-region>TopPlan</h1>
        <p data-tauri-drag-region>{activeFile?.name ?? text.subtitle}</p>
      </div>
    </div>

    <div class="window-actions">
      <button class="icon-button text-button" title={settings.language === 'zh' ? text.switchToEnglish : text.switchToChinese} onclick={toggleLanguage}>
        <Languages size={14} />
      </button>
      <button class="icon-button" title={text.refreshImageIndex} onclick={refreshImages}>
        <RefreshCw size={14} />
      </button>
      <button class="icon-button" title={text.settings} onclick={() => (showSettings = !showSettings)}>
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
              <button class:active={file.path === settings.activeFilePath} onclick={() => switchFile(file.path)} title={file.path}>
                <FileText size={14} />
                <span>{file.name}</span>
              </button>
            {/each}
          </div>
        </aside>
      {/if}

      <section class="document-surface" onscroll={revealScrollbars}>
        {#if sourceMode}
          <CodeMirrorEditor bind:this={sourceEditor} value={content} onChange={updateContent} />
        {:else}
          <article
            class="readable-editor"
            ondblclick={() => (sourceMode = true)}
            title={text.doubleClickToEdit}
          >
            {@html rendered}
          </article>
        {/if}
      </section>
    </section>

    <footer class="bottom-bar">
      <div class="bottom-left">
        <button class:active={sidebarOpen} class="bottom-icon" title={sidebarOpen ? text.hideSidebar : text.showSidebar} onclick={() => (sidebarOpen = !sidebarOpen)}>
          {#if sidebarOpen}
            <PanelLeftClose size={15} />
          {:else}
            <PanelLeftOpen size={15} />
          {/if}
        </button>
        <button class:active={sourceMode} class="bottom-icon" title={sourceMode ? text.readingMode : text.sourceMode} onclick={toggleSourceMode}>
          <Code2 size={15} />
        </button>
        <button class="bottom-icon" title={text.interrupted} onclick={insertInterruptedTask}>
          <Clock size={15} />
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

    {#if showSettings}
      <aside class="settings-popover">
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
