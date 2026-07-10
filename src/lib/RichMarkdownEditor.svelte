<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Editor, Extension, markInputRule, markPasteRule, mergeAttributes, Node as TiptapNode } from '@tiptap/core';
  import Image from '@tiptap/extension-image';
  import TaskItem from '@tiptap/extension-task-item';
  import TaskList from '@tiptap/extension-task-list';
  import { Markdown } from '@tiptap/markdown';
  import StarterKit from '@tiptap/starter-kit';
  import {
    normalizeEscapedInlineMarkdown,
    normalizeMarkdownDocumentForRichEditor,
    normalizeSerializedTaskMarkers,
    sourceLineAnchors,
    sourceLineAnchorsForRichBlocks,
  } from './markdownView';
  import type { ImageReference } from '../types';

  export let value = '';
  export let images: ImageReference[] = [];
  export let activeFilePath: string | null = null;
  export let zoom = 1;
  export let onChange: (value: string) => void = () => {};
  export let onPasteImage: (event: ClipboardEvent) => Promise<boolean> = async () => false;
  export let onReady: () => void = () => {};

  const TASK_TIMESTAMP_ATTR = 'data-topplan-time';
  const VISUAL_INDENT_ATTR = 'data-topplan-visual-indent';
  const TOPPLAN_INDENT_COMMENT = /^\s*<!--\s*topplan-indent:(\d+)\s*-->\s*$/i;
  const BOLD_STAR_INPUT_REGEX = /\*\*(?!\s+\*\*)((?:[^*]|\*(?!\*))+?)\*\*(?!\s+\*\*)$/;
  const BOLD_STAR_PASTE_REGEX = /\*\*(?!\s+\*\*)((?:[^*]|\*(?!\*))+?)\*\*(?!\s+\*\*)/g;
  const BOLD_UNDERSCORE_INPUT_REGEX = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))$/;
  const BOLD_UNDERSCORE_PASTE_REGEX = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))/g;
  const VISUAL_INDENT_NODE_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'listItem', 'taskItem']);
  const SOURCE_VISUAL_INDENT_NODE_TYPES = new Set(['paragraph', 'heading', 'blockquote']);
  const LIST_ITEM_NODE_TYPES = new Set(['listItem', 'taskItem']);

  type CursorAnchor = {
    line: number;
    yOffset: number;
  };

  type SourceMappedBlock = {
    element: HTMLElement;
    line: number;
    kind: 'block' | 'code';
  };

  type DebugBlock = {
    tag: string;
    text: string;
    line: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    blank: boolean;
  };

  let host: HTMLDivElement;
  let editor: Editor | null = null;
  let currentEditorKey = stateKey(activeFilePath);
  let lastExternalValue = value;
  let renderedMarkdown = value;
  let updatingFromOutside = false;
  let hasExplicitCursorAnchor = false;
  let lastCursorAnchor: CursorAnchor | null = null;
  let lastPointerSourceLine: number | null = null;
  let lastPointerYOffset: number | null = null;
  let preserveCursorAnchorUntil = 0;
  let scrollElement: HTMLElement | null = null;
  const editorsByFile = new Map<string, Editor>();
  const renderedMarkdownByFile = new Map<string, string>();

  function stateKey(path: string | null): string {
    return path ?? '__topplan_active_document__';
  }

  function equivalentMarkdown(left: string, right: string): boolean {
    return left.replace(/\r\n?/g, '\n').trimEnd() === right.replace(/\r\n?/g, '\n').trimEnd();
  }

  function escapeHtmlAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function textFromInlineContent(node: { content?: Array<{ text?: string }> }): string {
    return node.content?.map((child) => child.text ?? '').join('') ?? '';
  }

  const TaskTimestamp = TiptapNode.create({
    name: 'taskTimestamp',
    group: 'inline',
    inline: true,
    content: 'text*',
    selectable: false,

    addAttributes() {
      return {
        value: {
          default: '',
        },
      };
    },

    parseHTML() {
      return [
        {
          tag: `span[${TASK_TIMESTAMP_ATTR}]`,
          getAttrs: (element) => {
            if (!(element instanceof HTMLElement)) {
              return false;
            }
            const value = element.getAttribute(TASK_TIMESTAMP_ATTR) || element.textContent || '';
            return { value };
          },
        },
      ];
    },

    renderHTML({ node, HTMLAttributes }) {
      const value = String(node.attrs.value ?? '');
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          [TASK_TIMESTAMP_ATTR]: value,
          class: 'topplan-time-token',
        }),
        0,
      ];
    },

    renderMarkdown: (node) => {
      const value = escapeHtmlAttribute(textFromInlineContent(node) || String(node.attrs?.value ?? ''));
      return `<span ${TASK_TIMESTAMP_ATTR}="${value}">${value}</span>`;
    },
  });

  const VisualIndent = Extension.create({
    name: 'visualIndent',

    addGlobalAttributes() {
      return [
        {
          types: Array.from(VISUAL_INDENT_NODE_TYPES),
          attributes: {
            topplanVisualIndent: {
              default: 0,
              parseHTML: (element: HTMLElement) => Number(element.getAttribute(VISUAL_INDENT_ATTR)) || 0,
              renderHTML: (attributes: { topplanVisualIndent?: number }) => {
                const indent = Number(attributes.topplanVisualIndent ?? 0);
                if (indent <= 0) {
                  return {};
                }
                return {
                  [VISUAL_INDENT_ATTR]: String(indent),
                  style: `margin-left: ${indent}em;`,
                };
              },
            },
          },
        },
      ];
    },
  });

  const TopPlanBoldInputRules = Extension.create({
    name: 'topplanBoldInputRules',

    addInputRules() {
      const bold = this.editor.schema.marks.bold;
      if (!bold) {
        return [];
      }
      return [
        markInputRule({
          find: BOLD_STAR_INPUT_REGEX,
          type: bold,
        }),
        markInputRule({
          find: BOLD_UNDERSCORE_INPUT_REGEX,
          type: bold,
        }),
      ];
    },

    addPasteRules() {
      const bold = this.editor.schema.marks.bold;
      if (!bold) {
        return [];
      }
      return [
        markPasteRule({
          find: BOLD_STAR_PASTE_REGEX,
          type: bold,
        }),
        markPasteRule({
          find: BOLD_UNDERSCORE_PASTE_REGEX,
          type: bold,
        }),
      ];
    },
  });

  function stripTopplanIndentComments(markdown: string): { markdown: string; indents: Map<number, number> } {
    const output: string[] = [];
    const indents = new Map<number, number>();
    let pendingIndent: number | null = null;

    for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
      const marker = line.match(TOPPLAN_INDENT_COMMENT);
      if (marker) {
        pendingIndent = Math.max(0, Number(marker[1]) || 0);
        continue;
      }

      output.push(line);
      if (pendingIndent !== null && line.trim() !== '') {
        if (pendingIndent > 0) {
          indents.set(output.length, pendingIndent);
        }
        pendingIndent = null;
      }
    }

    return {
      markdown: output.join('\n'),
      indents,
    };
  }

  function indentableJsonNodes(root: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }): Array<{ attrs?: Record<string, unknown>; type?: string }> {
    const nodes: Array<{ attrs?: Record<string, unknown>; type?: string }> = [];

    function visit(node: unknown, listItemDepth = 0): void {
      if (!node || typeof node !== 'object') {
        return;
      }
      const current = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
      if (current.type && LIST_ITEM_NODE_TYPES.has(current.type)) {
        if (listItemDepth === 0) {
          nodes.push(current);
        }
        return;
      }
      if (current.type && SOURCE_VISUAL_INDENT_NODE_TYPES.has(current.type)) {
        nodes.push(current);
        if (current.type === 'blockquote') {
          return;
        }
      }
      current.content?.forEach((child) => visit(child, listItemDepth));
    }

    visit(root);
    return nodes;
  }

  function visualIndentAnchors(markdown: string): Array<{ line: number; kind: 'block' | 'code' }> {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    return sourceLineAnchors(markdown).filter((anchor) => {
      if (anchor.kind === 'code') {
        return false;
      }
      const line = lines[anchor.line - 1] ?? '';
      const trimmed = line.trimStart();
      const isListLine = /^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed);
      return !isListLine || line.length === trimmed.length;
    });
  }

  function applyTopplanIndentAttrs(doc: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }, markdown: string, indents: Map<number, number>): void {
    const anchors = visualIndentAnchors(markdown);
    const nodes = indentableJsonNodes(doc);
    anchors.forEach((anchor, index) => {
      const indent = indents.get(anchor.line) ?? 0;
      const node = nodes[index];
      if (!node || indent <= 0) {
        return;
      }
      node.attrs = {
        ...(node.attrs ?? {}),
        topplanVisualIndent: indent,
      };
    });
  }

  function serializeTopplanIndentComments(doc: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }, markdown: string): string {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const anchors = visualIndentAnchors(markdown);
    const nodes = indentableJsonNodes(doc);
    const indentsByLine = new Map<number, number>();

    anchors.forEach((anchor, index) => {
      const indent = Number(nodes[index]?.attrs?.topplanVisualIndent ?? 0);
      if (indent > 0) {
        indentsByLine.set(anchor.line, indent);
      }
    });

    const output: string[] = [];
    lines.forEach((line, index) => {
      const indent = indentsByLine.get(index + 1);
      if (indent && line.trim() !== '') {
        output.push(`<!-- topplan-indent:${indent} -->`);
      }
      output.push(line);
    });
    return output.join('\n');
  }

  function handleContainerScroll(): void {
    if (Date.now() > preserveCursorAnchorUntil) {
      hasExplicitCursorAnchor = false;
      lastCursorAnchor = null;
      lastPointerSourceLine = null;
      lastPointerYOffset = null;
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

  function isStandaloneBlankParagraph(element: HTMLElement): boolean {
    return element.tagName === 'P' && !element.closest('li') && (element.textContent ?? '').trim() === '';
  }

  function mappedBlocks(): SourceMappedBlock[] {
    const anchors = sourceLineAnchorsForRichBlocks(renderedMarkdown);
    let nextAnchorIndex = 0;

    return richBlocks().flatMap((element) => {
      const wantsBlankAnchor = isStandaloneBlankParagraph(element);
      const anchorIndex = anchors.findIndex((anchor, index) => index >= nextAnchorIndex && anchor.blank === wantsBlankAnchor);
      if (anchorIndex === -1) {
        return [];
      }
      nextAnchorIndex = anchorIndex + 1;
      const anchor = anchors[anchorIndex];
      return [{ element, line: anchor.line, kind: anchor.kind }];
    });
  }

  function sourceLineCount(): number {
    return Math.max(1, renderedMarkdown.replace(/\r\n?/g, '\n').split('\n').length);
  }

  function clampSourceLine(line: number): number {
    return Math.min(Math.max(1, line), sourceLineCount());
  }

  function sourceLineFromBlockPosition(block: SourceMappedBlock, position: number): number {
    if (!editor) {
      return clampSourceLine(block.line);
    }

    const safePosition = Math.min(Math.max(0, position), editor.state.doc.content.size);
    const $position = editor.state.doc.resolve(safePosition);
    if (block.kind === 'code') {
      if ($position.parent.type.name !== 'codeBlock') {
        return clampSourceLine(block.line);
      }
      const textBeforePointer = $position.parent.textBetween(0, $position.parentOffset, '\n', '\n');
      return clampSourceLine(block.line + textBeforePointer.split('\n').length);
    }

    const maxOffset = sourceSpanForBlock(block) - 1;
    if (maxOffset <= 0) {
      return clampSourceLine(block.line);
    }
    const textBeforePointer = $position.parent.textBetween(0, $position.parentOffset, '\n', '\n');
    const sourceLineOffset = Math.min(maxOffset, textBeforePointer.split('\n').length - 1);
    return clampSourceLine(block.line + sourceLineOffset);
  }

  function sourceLineFromClientPoint(clientX: number, clientY: number): number | null {
    const blocks = mappedBlocks();
    if (blocks.length === 0) {
      return null;
    }

    const measured = blocks.map((block) => ({
      block,
      rect: block.element.getBoundingClientRect(),
    }));

    const first = measured[0];
    if (clientY < first.rect.top) {
      return clampSourceLine(first.block.line);
    }

    for (let index = 0; index < measured.length; index += 1) {
      const current = measured[index];
      const next = measured[index + 1];
      if (clientY >= current.rect.top && clientY <= current.rect.bottom) {
        const pointerPosition = editor?.view.posAtCoords({ left: clientX, top: clientY })?.pos;
        return pointerPosition === undefined
          ? clampSourceLine(current.block.line)
          : sourceLineFromBlockPosition(current.block, pointerPosition);
      }
      if (!next || clientY < current.rect.bottom || clientY > next.rect.top) {
        continue;
      }

      const firstGapLine = current.block.line + 1;
      const lastGapLine = next.block.line - 1;
      if (firstGapLine > lastGapLine) {
        return clampSourceLine(next.block.line);
      }

      const gapHeight = Math.max(1, next.rect.top - current.rect.bottom);
      const relative = Math.min(0.999, Math.max(0, (clientY - current.rect.bottom) / gapHeight));
      return clampSourceLine(firstGapLine + Math.floor(relative * (lastGapLine - firstGapLine + 1)));
    }

    const last = measured[measured.length - 1];
    if (clientY > last.rect.bottom) {
      return clampSourceLine(sourceLineCount() > last.block.line ? sourceLineCount() : last.block.line);
    }

    return null;
  }

  function rememberPointerSourceLine(event: MouseEvent | PointerEvent): void {
    const line = sourceLineFromClientPoint(event.clientX, event.clientY);
    if (line !== null) {
      lastPointerSourceLine = line;
      const container = scrollContainer();
      lastPointerYOffset = container ? event.clientY - container.getBoundingClientRect().top : null;
    }
  }

  function handleHostPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, button, select, textarea, a')) {
      return;
    }
    hasExplicitCursorAnchor = true;
    rememberPointerSourceLine(event);
  }

  function sourceSpanForBlock(block: SourceMappedBlock): number {
    const blocks = mappedBlocks();
    const index = blocks.findIndex((item) => item.element === block.element);
    const nextLine = index >= 0 ? blocks[index + 1]?.line : undefined;
    return Math.max(1, (nextLine ?? sourceLineCount() + 1) - block.line);
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

  function textLineOffsetFromSelection(block: SourceMappedBlock): number {
    if (!editor) {
      return 0;
    }
    const maxOffset = sourceSpanForBlock(block) - 1;
    if (maxOffset <= 0) {
      return 0;
    }

    const selection = editor.state.selection;
    const textBeforeCursor = selection.$head.parent.textBetween(0, selection.$head.parentOffset, '\n', '\n');
    const explicitOffset = textBeforeCursor.split('\n').length - 1;
    if (explicitOffset > 0) {
      return Math.min(maxOffset, explicitOffset);
    }

    try {
      const coords = editor.view.coordsAtPos(selection.head);
      const blockBox = block.element.getBoundingClientRect();
      const style = getComputedStyle(block.element);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.7 || 24;
      const visualOffset = Math.round((coords.top - blockBox.top) / lineHeight);
      return Math.min(maxOffset, Math.max(0, visualOffset));
    } catch {
      return 0;
    }
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
    if (!editor) {
      return value;
    }
    const markdown = normalizeSerializedTaskMarkers(editor.getMarkdown());
    return serializeTopplanIndentComments(editor.getJSON(), markdown);
  }

  function emitMarkdown(): void {
    if (!editor || updatingFromOutside) {
      return;
    }
    const editorMarkdown = normalizeSerializedTaskMarkers(editor.getMarkdown());
    const sourceMarkdown = serializeTopplanIndentComments(editor.getJSON(), editorMarkdown);
    renderedMarkdown = editorMarkdown;
    renderedMarkdownByFile.set(currentEditorKey, editorMarkdown);
    if (sourceMarkdown !== lastExternalValue) {
      lastExternalValue = sourceMarkdown;
      onChange(sourceMarkdown);
    }
    scheduleRenderedContentPatch();
  }

  export function insertMarkdown(markdown: string): void {
    if (!editor) {
      return;
    }
    editor.chain().focus().insertContent(markdown, { contentType: 'markdown' }).run();
    emitMarkdown();
  }

  export function insertTimestamp(value: string): void {
    if (!editor) {
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'text', text: ' ' },
        {
          type: 'taskTimestamp',
          attrs: { value },
          content: [{ type: 'text', text: value }],
        },
        { type: 'text', text: ' ' },
      ])
      .run();
    emitMarkdown();
  }

  export function getSelectedSourceLine(): number {
    if (lastPointerSourceLine !== null) {
      return lastPointerSourceLine;
    }
    const block = selectedBlock();
    if (!block) {
      return getTopLine();
    }
    if (block.kind === 'code') {
      return block.line + codeLineOffsetFromSelection();
    }
    return block.line + textLineOffsetFromSelection(block);
  }

  function documentLineFromEditorLine(markdown: string, editorLine: number): number {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const targetEditorLine = Math.max(1, editorLine);
    let currentEditorLine = 0;

    for (let index = 0; index < lines.length; index += 1) {
      if (TOPPLAN_INDENT_COMMENT.test(lines[index])) {
        continue;
      }
      currentEditorLine += 1;
      if (currentEditorLine === targetEditorLine) {
        return index + 1;
      }
    }

    return Math.max(1, lines.length);
  }

  export function getTaskToggleTarget(markdown: string): { editorLine: number; documentLine: number } {
    const editorLine = getSelectedSourceLine();
    return {
      editorLine,
      documentLine: documentLineFromEditorLine(markdown, editorLine),
    };
  }

  export function getSourceLineAnchor(line: number): CursorAnchor {
    const targetLine = clampSourceLine(line);
    const container = scrollContainer();
    if (lastPointerSourceLine === targetLine && lastPointerYOffset !== null) {
      return { line: targetLine, yOffset: lastPointerYOffset };
    }
    if (!container) {
      return { line: targetLine, yOffset: 24 };
    }
    const block = blockForLine(targetLine);
    if (!block) {
      return { line: targetLine, yOffset: Math.min(container.clientHeight - 24, Math.max(24, container.clientHeight / 2)) };
    }
    return {
      line: targetLine,
      yOffset: block.element.getBoundingClientRect().top - container.getBoundingClientRect().top,
    };
  }

  export function getDebugSnapshot(): {
    markdown: string;
    selectedSourceLine: number;
    lastPointerSourceLine: number | null;
    blocks: DebugBlock[];
  } {
    return {
      markdown: renderedMarkdown,
      selectedSourceLine: getSelectedSourceLine(),
      lastPointerSourceLine,
      blocks: mappedBlocks().map((block) => {
        const rect = block.element.getBoundingClientRect();
        return {
          tag: block.element.tagName,
          text: block.element.textContent ?? '',
          line: block.line,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          blank: isStandaloneBlankParagraph(block.element),
        };
      }),
    };
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
    if (!container) {
      return null;
    }
    if (lastPointerSourceLine !== null) {
      return {
        line: lastPointerSourceLine,
        yOffset: lastPointerYOffset ?? Math.min(container.clientHeight - 24, Math.max(24, container.clientHeight / 2)),
      };
    }

    const block = selectedBlock();
    const coords = editor.view.coordsAtPos(editor.state.selection.head);
    if (!coords) {
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
    if (!hasExplicitCursorAnchor && lastPointerSourceLine === null) {
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
    const prepared = stripTopplanIndentComments(normalizeEscapedInlineMarkdown(markdown));
    renderedMarkdown = prepared.markdown;
    renderedMarkdownByFile.set(currentEditorKey, prepared.markdown);
    hasExplicitCursorAnchor = false;
    lastCursorAnchor = null;
    lastPointerSourceLine = null;
    lastPointerYOffset = null;
    updatingFromOutside = true;
    const parsed = editor.markdown?.parse(prepared.markdown || '\n');
    if (parsed) {
      const normalized = normalizeMarkdownDocumentForRichEditor(parsed);
      applyTopplanIndentAttrs(normalized, prepared.markdown, prepared.indents);
      editor.chain().setMeta('addToHistory', false).setContent(normalized, { emitUpdate: false }).run();
    } else {
      editor
        .chain()
        .setMeta('addToHistory', false)
        .setContent(prepared.markdown || '\n', { contentType: 'markdown', emitUpdate: false })
        .run();
    }
    if (prepared.markdown.trim() && !editor.getText().trim()) {
      editor.chain().setMeta('addToHistory', false).setContent(prepared.markdown, { contentType: 'markdown', emitUpdate: false }).run();
    }
    updatingFromOutside = false;
    scheduleRenderedContentPatch();
  }

  function visualIndentTarget():
    | {
        pos: number;
        node: { attrs: Record<string, unknown>; type: { name: string } };
      }
    | null {
    if (!editor) {
      return null;
    }
    const $from = editor.state.selection.$from;
    let textBlockTarget:
      | {
          pos: number;
          node: { attrs: Record<string, unknown>; type: { name: string } };
        }
      | null = null;

    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (!SOURCE_VISUAL_INDENT_NODE_TYPES.has(node.type.name)) {
        continue;
      }
      const target = {
        pos: $from.before(depth),
        node: node as { attrs: Record<string, unknown>; type: { name: string } },
      };
      textBlockTarget ??= target;
    }
    return textBlockTarget;
  }

  function activeListItemTarget():
    | {
        type: 'listItem' | 'taskItem';
        pos: number;
        node: { attrs: Record<string, unknown>; type: { name: string } };
        isTopLevel: boolean;
      }
    | null {
    if (!editor) {
      return null;
    }
    const $from = editor.state.selection.$from;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const typeName = $from.node(depth).type.name;
      if (typeName === 'listItem' || typeName === 'taskItem') {
        let isTopLevel = true;
        for (let ancestorDepth = depth - 1; ancestorDepth > 0; ancestorDepth -= 1) {
          if (LIST_ITEM_NODE_TYPES.has($from.node(ancestorDepth).type.name)) {
            isTopLevel = false;
            break;
          }
        }
        return {
          type: typeName,
          pos: $from.before(depth),
          node: $from.node(depth) as { attrs: Record<string, unknown>; type: { name: string } },
          isTopLevel,
        };
      }
    }
    return null;
  }

  function adjustCurrentListIndent(itemType: 'listItem' | 'taskItem', direction: 1 | -1): boolean {
    if (!editor) {
      return false;
    }
    return direction > 0 ? editor.commands.sinkListItem(itemType) : editor.commands.liftListItem(itemType);
  }

  function adjustVisualIndentTarget(
    target: {
      pos: number;
      node: { attrs: Record<string, unknown>; type: { name: string } };
    },
    direction: 1 | -1
  ): boolean {
    if (!editor) {
      return false;
    }
    const currentIndent = Number(target.node.attrs.topplanVisualIndent ?? 0);
    const nextIndent = Math.max(0, currentIndent + direction);
    if (nextIndent === currentIndent) {
      editor.view.focus();
      return true;
    }
    editor.view.dispatch(
      editor.state.tr
        .setNodeMarkup(target.pos, undefined, {
          ...target.node.attrs,
          topplanVisualIndent: nextIndent,
        })
        .scrollIntoView()
    );
    editor.view.focus();
    return true;
  }

  function adjustCurrentVisualIndent(direction: 1 | -1): boolean {
    if (!editor || editor.state.selection.$head.parent.type.name === 'codeBlock') {
      return false;
    }
    const target = visualIndentTarget();
    if (!target) {
      return false;
    }
    return adjustVisualIndentTarget(target, direction);
  }

  function handleTabIndent(event: KeyboardEvent): boolean {
    if (!editor || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    if (editor.state.selection.$head.parent.type.name === 'codeBlock') {
      return false;
    }
    event.preventDefault();
    hasExplicitCursorAnchor = true;
    const direction = event.shiftKey ? -1 : 1;
    const listTarget = activeListItemTarget();
    let handled = false;
    if (listTarget) {
      if (listTarget.type === 'taskItem' && listTarget.isTopLevel) {
        handled = adjustVisualIndentTarget(listTarget, direction);
      } else {
        handled = adjustCurrentListIndent(listTarget.type, direction);
        if (!handled && listTarget.isTopLevel) {
          handled = adjustVisualIndentTarget(listTarget, direction);
        }
      }
    } else {
      handled = adjustCurrentVisualIndent(direction);
    }
    requestAnimationFrame(rememberCursorAnchor);
    return listTarget ? true : handled;
  }

  function isAtBlockStart(): boolean {
    if (!editor || !editor.state.selection.empty) {
      return false;
    }
    return editor.state.selection.$from.parentOffset === 0;
  }

  function handleDeleteVisualIndent(event: KeyboardEvent): boolean {
    if (!editor || (event.key !== 'Backspace' && event.key !== 'Delete') || event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    if (editor.state.selection.$head.parent.type.name === 'codeBlock' || !isAtBlockStart()) {
      return false;
    }

    const listTarget = activeListItemTarget();
    const target = listTarget && Number(listTarget.node.attrs.topplanVisualIndent ?? 0) > 0 ? listTarget : visualIndentTarget();
    if (!target || Number(target.node.attrs.topplanVisualIndent ?? 0) <= 0) {
      return false;
    }

    event.preventDefault();
    hasExplicitCursorAnchor = true;
    const handled = adjustVisualIndentTarget(target, -1);
    requestAnimationFrame(rememberCursorAnchor);
    return handled;
  }

  function clearStoredBoldOnEnter(event: KeyboardEvent): void {
    if (!editor || event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (editor.state.selection.$head.parent.type.name === 'codeBlock') {
      return;
    }
    const bold = editor.schema.marks.bold;
    if (!bold) {
      return;
    }
    requestAnimationFrame(() => {
      if (!editor?.isFocused) {
        return;
      }
      editor.view.dispatch(editor.state.tr.removeStoredMark(bold).setMeta('addToHistory', false));
    });
  }

  function selectedClipboardText(view: { state: { selection: { empty: boolean; from: number; to: number }; doc: { textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string } } }): string {
    const selection = view.state.selection;
    if (selection.empty) {
      return '';
    }
    return view.state.doc.textBetween(selection.from, selection.to, '\n', '\n').replace(/\r\n?/g, '\n');
  }

  function createEditor(element: HTMLElement | null): Editor {
    return new Editor({
      element,
      extensions: [
        TaskTimestamp,
        VisualIndent,
        TopPlanBoldInputRules,
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
        handleClick(_view, _position, event) {
          hasExplicitCursorAnchor = true;
          rememberPointerSourceLine(event);
          requestAnimationFrame(rememberCursorAnchor);
          return false;
        },
        handleKeyDown(_view: unknown, event: KeyboardEvent) {
          hasExplicitCursorAnchor = true;
          lastPointerSourceLine = null;
          lastPointerYOffset = null;
          if (handleDeleteVisualIndent(event)) {
            return true;
          }
          if (handleTabIndent(event)) {
            return true;
          }
          clearStoredBoldOnEnter(event);
          requestAnimationFrame(rememberCursorAnchor);
          return false;
        },
        handleDOMEvents: {
          pointerdown(_view, event) {
            hasExplicitCursorAnchor = true;
            rememberPointerSourceLine(event);
            return false;
          },
          pointerup(_view, event) {
            hasExplicitCursorAnchor = true;
            rememberPointerSourceLine(event);
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
          copy(view, event: ClipboardEvent) {
            if (!event.clipboardData) {
              return false;
            }
            const text = selectedClipboardText(view);
            if (!text) {
              return false;
            }
            event.clipboardData.clearData();
            event.clipboardData.setData('text/plain', text);
            event.preventDefault();
            return true;
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
  }

  function activateEditorForFile(path: string | null, nextValue: string): void {
    if (!host || !editor) {
      return;
    }
    const nextKey = stateKey(path);
    if (nextKey === currentEditorKey) {
      return;
    }

    if (!editorsByFile.has(nextKey) && equivalentMarkdown(currentMarkdown(), nextValue)) {
      editorsByFile.delete(currentEditorKey);
      renderedMarkdownByFile.delete(currentEditorKey);
      currentEditorKey = nextKey;
      editorsByFile.set(currentEditorKey, editor);
      lastExternalValue = nextValue;
      renderedMarkdownByFile.set(currentEditorKey, renderedMarkdown);
      scheduleRenderedContentPatch();
      return;
    }

    renderedMarkdownByFile.set(currentEditorKey, renderedMarkdown);
    editor.unmount();
    currentEditorKey = nextKey;
    hasExplicitCursorAnchor = false;
    lastCursorAnchor = null;
    lastPointerSourceLine = null;
    lastPointerYOffset = null;

    const cachedEditor = editorsByFile.get(nextKey);
    if (cachedEditor) {
      editor = cachedEditor;
      editor.mount(host);
      applyZoom();
      lastExternalValue = nextValue;
      renderedMarkdown = renderedMarkdownByFile.get(nextKey) ?? nextValue;
      const markdown = currentMarkdown();
      if (equivalentMarkdown(markdown, nextValue)) {
        renderedMarkdown = markdown;
        renderedMarkdownByFile.set(currentEditorKey, markdown);
        scheduleRenderedContentPatch();
      } else {
        setMarkdown(nextValue);
      }
      return;
    }

    editor = createEditor(host);
    editorsByFile.set(nextKey, editor);
    lastExternalValue = nextValue;
    setMarkdown(nextValue);
    applyZoom();
  }

  onMount(() => {
    currentEditorKey = stateKey(activeFilePath);
    editor = createEditor(host);
    editorsByFile.set(currentEditorKey, editor);
    lastExternalValue = value;
    setMarkdown(value);
    applyZoom();
    onReady();
    scrollElement = scrollContainer();
    host.addEventListener('pointerdown', handleHostPointerDown, { capture: true });
    scrollElement?.addEventListener('scroll', handleContainerScroll, { passive: true });
  });

  $: if (editor && stateKey(activeFilePath) !== currentEditorKey) {
    activateEditorForFile(activeFilePath, value);
  }

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
    host?.removeEventListener('pointerdown', handleHostPointerDown, { capture: true });
    scrollElement?.removeEventListener('scroll', handleContainerScroll);
    for (const instance of new Set(editorsByFile.values())) {
      instance.destroy();
    }
    editorsByFile.clear();
    renderedMarkdownByFile.clear();
  });
</script>

<div bind:this={host} class="rich-editor-host" style={`--editor-zoom: ${zoom}`} aria-label="Markdown rich editor"></div>
