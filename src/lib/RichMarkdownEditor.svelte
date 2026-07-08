<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import Image from '@tiptap/extension-image';
  import TaskItem from '@tiptap/extension-task-item';
  import TaskList from '@tiptap/extension-task-list';
  import { Markdown } from '@tiptap/markdown';
  import StarterKit from '@tiptap/starter-kit';
  import { normalizeMarkdownDocumentForRichEditor, sourceLineAnchors } from './markdownView';
  import type { ImageReference } from '../types';

  export let value = '';
  export let images: ImageReference[] = [];
  export let activeFilePath: string | null = null;
  export let zoom = 1;
  export let onChange: (value: string) => void = () => {};
  export let onPasteImage: (event: ClipboardEvent) => Promise<boolean> = async () => false;
  export let onReady: () => void = () => {};

  type CursorAnchor = {
    line: number;
    yOffset: number;
  };

  type SourceMappedBlock = {
    element: HTMLElement;
    line: number;
    kind: 'block' | 'code';
  };

  let host: HTMLDivElement;
  let editor: Editor | null = null;
  let lastExternalValue = value;
  let renderedMarkdown = value;
  let updatingFromOutside = false;
  let hasExplicitCursorAnchor = false;
  let lastCursorAnchor: CursorAnchor | null = null;
  let preserveCursorAnchorUntil = 0;
  let scrollElement: HTMLElement | null = null;

  function handleContainerScroll(): void {
    if (Date.now() > preserveCursorAnchorUntil) {
      hasExplicitCursorAnchor = false;
      lastCursorAnchor = null;
    }
  }

  function scrollContainer(): HTMLElement | null {
    return host?.closest('.document-surface') as HTMLElement | null;
  }

  function imageMap(): Map<string, string> {
    const output = new Map<string, string>();
    for (const reference of images) {
      if (reference.sourceFile === activeFilePath && reference.dataUrl) {
        output.set(reference.rawPath, reference.dataUrl);
      }
    }
    return output;
  }

  function patchImageSources(): void {
    if (!editor) {
      return;
    }
    const map = imageMap();
    editor.view.dom.querySelectorAll('img[src]').forEach((image) => {
      const element = image as HTMLImageElement;
      const rawSource = element.getAttribute('data-markdown-src') ?? element.getAttribute('src') ?? '';
      if (!element.getAttribute('data-markdown-src')) {
        element.setAttribute('data-markdown-src', rawSource);
      }
      const converted = map.get(rawSource);
      if (converted) {
        element.src = converted;
      }
    });
  }

  function richBlocks(): HTMLElement[] {
    if (!editor) {
      return [];
    }
    const blockSelector = 'h1, h2, h3, h4, h5, h6, p, pre, blockquote, table, img, li';
    const candidates = Array.from(editor.view.dom.querySelectorAll(blockSelector)) as HTMLElement[];
    return candidates.filter((element) => {
      if (element.tagName === 'LI') {
        return !element.querySelector('h1, h2, h3, h4, h5, h6, p, pre, blockquote, table, img');
      }
      if (element.tagName === 'BLOCKQUOTE') {
        return !element.querySelector('h1, h2, h3, h4, h5, h6, p, pre, table, img, li');
      }
      return true;
    });
  }

  function mappedBlocks(): SourceMappedBlock[] {
    const anchors = sourceLineAnchors(renderedMarkdown);
    return richBlocks().flatMap((element, index) => {
      const anchor = anchors[index];
      return anchor ? [{ element, line: anchor.line, kind: anchor.kind }] : [];
    });
  }

  function selectedBlock(): SourceMappedBlock | null {
    if (!editor) {
      return null;
    }
    const mapped = mappedBlocks();
    const selection = editor.state.selection;
    let cursorTop: number | null = null;
    try {
      const coords = editor.view.coordsAtPos(selection.head);
      cursorTop = coords.top;
      const elementAtCursor = document.elementFromPoint(coords.left, coords.top);
      const blockAtCursor = mapped.findLast((block) => elementAtCursor ? block.element.contains(elementAtCursor) : false) ?? null;
      if (blockAtCursor) {
        return blockAtCursor;
      }
    } catch {
      // Fall through to DOM position lookup.
    }

    try {
      const domAtPosition = editor.view.domAtPos(selection.head);
      const node = domAtPosition.node.nodeType === Node.ELEMENT_NODE ? domAtPosition.node : domAtPosition.node.parentElement;
      return mapped.findLast((block) => node instanceof Element ? block.element.contains(node) : false) ?? null;
    } catch {
      if (cursorTop === null) {
        return null;
      }
    }

    if (cursorTop === null) {
      return null;
    }
    return mapped.reduce<SourceMappedBlock | null>((nearest, block) => {
      if (!nearest) {
        return block;
      }
      const blockDistance = Math.abs(block.element.getBoundingClientRect().top - cursorTop);
      const nearestDistance = Math.abs(nearest.element.getBoundingClientRect().top - cursorTop);
      return blockDistance < nearestDistance ? block : nearest;
    }, null);
  }

  function blockForLine(line: number): SourceMappedBlock | null {
    const blocks = mappedBlocks();
    if (blocks.length === 0) {
      return null;
    }
    if (!blocksCoverLine(blocks, line)) {
      return null;
    }

    return blocks.reduce((best, block) => {
      if (block.line <= line && block.line >= best.line) {
        return block;
      }
      return best;
    }, blocks[0]);
  }

  function codeLineOffsetFromSelection(): number {
    if (!editor) {
      return 0;
    }
    const selection = editor.state.selection;
    const head = selection.$head;
    if (head.parent.type.name !== 'codeBlock') {
      return 0;
    }
    const textBeforeCursor = head.parent.textBetween(0, head.parentOffset, '\n', '\n');
    return textBeforeCursor.split('\n').length;
  }

  function selectionPositionForBlock(block: SourceMappedBlock, sourceLine: number): number | null {
    if (!editor) {
      return null;
    }

    try {
      if (block.element.tagName === 'PRE') {
        const code = block.element.querySelector('code') ?? block.element;
        const startPosition = editor.view.posAtDOM(code, 0);
        const blockLine = block.line;
        const relativeLine = Math.max(0, sourceLine - blockLine - 1);
        const lines = block.element.textContent?.split('\n') ?? [''];
        const offset = lines.slice(0, relativeLine).reduce((sum, text) => sum + text.length + 1, 0);
        return Math.min(startPosition + offset, editor.state.doc.content.size);
      }
      return editor.view.posAtDOM(block.element, 0);
    } catch {
      return null;
    }
  }

  function patchSourceLineAnchors(): void {
    // Keep this hook for image/render scheduling; line mapping is computed on demand.
  }

  function patchRenderedContent(): void {
    patchImageSources();
    patchSourceLineAnchors();
  }

  function scheduleRenderedContentPatch(): void {
    queueMicrotask(() => {
      patchRenderedContent();
      requestAnimationFrame(patchRenderedContent);
    });
  }

  function applyZoom(nextZoom = zoom): void {
    if (host) {
      host.style.setProperty('--editor-zoom', String(nextZoom));
    }
    if (editor) {
      editor.view.dom.style.setProperty('--editor-zoom', String(nextZoom));
      editor.view.dom.style.fontSize = `calc(17px * ${nextZoom})`;
    }
  }

  function currentMarkdown(): string {
    return editor?.getMarkdown().trimEnd() ?? value;
  }

  function emitMarkdown(): void {
    if (!editor || updatingFromOutside) {
      return;
    }
    const markdown = currentMarkdown();
    lastExternalValue = markdown;
    renderedMarkdown = markdown;
    onChange(markdown);
    scheduleRenderedContentPatch();
  }

  export function insertMarkdown(markdown: string): void {
    if (!editor) {
      return;
    }
    editor.chain().focus().insertContent(markdown, { contentType: 'markdown' }).run();
    emitMarkdown();
  }

  export function insertImage(markdownPath: string): void {
    if (!editor) {
      return;
    }
    editor.chain().focus().setImage({ src: markdownPath }).run();
    emitMarkdown();
  }

  export function getTopLine(): number {
    const container = scrollContainer();
    const blocks = mappedBlocks();
    if (!container || blocks.length === 0) {
      return 1;
    }

    const viewportTop = container.getBoundingClientRect().top + 1;
    let best = blocks[0];
    for (const block of blocks) {
      if (block.element.getBoundingClientRect().top <= viewportTop) {
        best = block;
      } else {
        break;
      }
    }
    return best.line;
  }

  export function scrollToLine(line: number): boolean {
    const container = scrollContainer();
    const blocks = mappedBlocks();
    if (!container || blocks.length === 0) {
      return false;
    }
    if (!blocksCoverLine(blocks, line)) {
      return false;
    }

    const target = blocks.reduce((best, block) => {
      if (block.line <= line && block.line >= best.line) {
        return block;
      }
      return best;
    }, blocks[0]);

    const containerTop = container.getBoundingClientRect().top;
    const targetTop = target.element.getBoundingClientRect().top;
    preserveCursorAnchorUntil = Date.now() + 250;
    container.scrollTop += targetTop - containerTop;
    return true;
  }

  function blocksCoverLine(blocks: SourceMappedBlock[], line: number): boolean {
    const lastBlock = blocks[blocks.length - 1];
    return line <= lastBlock.line + 8;
  }

  function readCursorAnchor(): CursorAnchor | null {
    if (!editor) {
      return null;
    }

    const container = scrollContainer();
    const block = selectedBlock();
    const coords = editor.view.coordsAtPos(editor.state.selection.head);
    if (!container || !coords) {
      return null;
    }
    const containerTop = container.getBoundingClientRect().top;
    const yOffset = coords.top - containerTop;
    if (yOffset < -24 || yOffset > container.clientHeight + 24) {
      return null;
    }
    if (!block) {
      return { line: getTopLine(), yOffset };
    }
    const line = block.kind === 'code' ? block.line + codeLineOffsetFromSelection() : block.line;

    return {
      line,
      yOffset,
    };
  }

  function rememberCursorAnchor(): void {
    if (!editor) {
      return;
    }
    const anchor = readCursorAnchor();
    if (anchor) {
      lastCursorAnchor = anchor;
    }
  }

  export function getCursorAnchor(): CursorAnchor | null {
    if (!hasExplicitCursorAnchor) {
      return null;
    }
    const anchor = readCursorAnchor();
    if (!anchor) {
      hasExplicitCursorAnchor = false;
      lastCursorAnchor = null;
      return null;
    }
    lastCursorAnchor = anchor;
    return anchor;
  }

  export function setCursorAnchor(anchor: CursorAnchor): boolean {
    if (!editor) {
      return false;
    }
    hasExplicitCursorAnchor = true;

    const container = scrollContainer();
    const block = blockForLine(anchor.line);
    const position = block ? selectionPositionForBlock(block, anchor.line) : null;
    if (!container || !block) {
      return false;
    }
    preserveCursorAnchorUntil = Date.now() + 250;
    if (position !== null) {
      const safePosition = Math.min(Math.max(1, position), editor.state.doc.content.size);
      editor.commands.setTextSelection(safePosition);
      editor.view.focus();
    }

    requestAnimationFrame(() => {
      if (!editor || !container || !block.element.isConnected) {
        return;
      }
      const coords = position !== null ? editor.view.coordsAtPos(editor.state.selection.head) : block.element.getBoundingClientRect();
      const containerTop = container.getBoundingClientRect().top;
      preserveCursorAnchorUntil = Date.now() + 250;
      container.scrollTop += coords.top - containerTop - anchor.yOffset;
      rememberCursorAnchor();
    });
    return true;
  }

  function setMarkdown(markdown: string): void {
    if (!editor) {
      return;
    }
    renderedMarkdown = markdown;
    hasExplicitCursorAnchor = false;
    lastCursorAnchor = null;
    updatingFromOutside = true;
    const parsed = editor.markdown?.parse(markdown || '\n');
    if (parsed) {
      const normalized = normalizeMarkdownDocumentForRichEditor(parsed);
      editor.commands.setContent(normalized, { emitUpdate: false });
    } else {
      editor.commands.setContent(markdown || '\n', { contentType: 'markdown', emitUpdate: false });
    }
    if (markdown.trim() && !editor.getText().trim()) {
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    }
    updatingFromOutside = false;
    scheduleRenderedContentPatch();
  }

  onMount(() => {
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        Image.configure({
          allowBase64: true,
          inline: false,
        }),
        Markdown.configure({
          indentation: {
            style: 'space',
            size: 2,
          },
        }),
      ],
      content: '\n',
      editorProps: {
        attributes: {
          class: 'rich-editor',
          spellcheck: 'false',
        },
        handlePaste(_view, event) {
          const hasImage = event.clipboardData ? Array.from(event.clipboardData.items).some((item) => item.type.startsWith('image/')) : false;
          if (!hasImage) {
            return false;
          }
          void onPasteImage(event);
          return true;
        },
        handleClick() {
          hasExplicitCursorAnchor = true;
          requestAnimationFrame(rememberCursorAnchor);
          return false;
        },
        handleKeyDown() {
          hasExplicitCursorAnchor = true;
          requestAnimationFrame(rememberCursorAnchor);
          return false;
        },
        handleDOMEvents: {
          pointerdown() {
            hasExplicitCursorAnchor = true;
            return false;
          },
          pointerup() {
            hasExplicitCursorAnchor = true;
            requestAnimationFrame(rememberCursorAnchor);
            return false;
          },
          keyup() {
            hasExplicitCursorAnchor = true;
            requestAnimationFrame(rememberCursorAnchor);
            return false;
          },
          focus() {
            hasExplicitCursorAnchor = true;
            requestAnimationFrame(rememberCursorAnchor);
            return false;
          },
        },
      },
      onUpdate() {
        emitMarkdown();
        if (editor?.isFocused) {
          hasExplicitCursorAnchor = true;
          requestAnimationFrame(rememberCursorAnchor);
        }
      },
      onSelectionUpdate() {
        if (editor?.isFocused) {
          hasExplicitCursorAnchor = true;
          rememberCursorAnchor();
        }
      },
      onFocus() {
        hasExplicitCursorAnchor = true;
        rememberCursorAnchor();
      },
      onCreate() {
        applyZoom();
        scheduleRenderedContentPatch();
      },
    });
    lastExternalValue = value;
    setMarkdown(value);
    applyZoom();
    onReady();
    scrollElement = scrollContainer();
    scrollElement?.addEventListener('scroll', handleContainerScroll, { passive: true });
  });

  $: if (editor && value !== lastExternalValue) {
    lastExternalValue = value;
    setMarkdown(value);
  }

  $: if (host || editor) {
    applyZoom(zoom);
  }

  $: if (editor && images) {
    scheduleRenderedContentPatch();
  }

  onDestroy(() => {
    scrollElement?.removeEventListener('scroll', handleContainerScroll);
    editor?.destroy();
  });
</script>

<div bind:this={host} class="rich-editor-host" style={`--editor-zoom: ${zoom}`} aria-label="Markdown rich editor"></div>
