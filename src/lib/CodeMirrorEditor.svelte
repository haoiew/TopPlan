<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { markdown } from '@codemirror/lang-markdown';
  import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
  import { EditorState } from '@codemirror/state';
  import {
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
  } from '@codemirror/view';

  export let value = '';
  export let editable = true;
  export let zoom = 1;
  export let onChange: (value: string) => void = () => {};
  export let onReady: () => void = () => {};

  type CursorAnchor = {
    line: number;
    yOffset: number;
  };

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let hasExplicitCursorAnchor = false;
  let lastCursorAnchor: CursorAnchor | null = null;
  let preserveCursorAnchorUntil = 0;
  let pendingScrollTimers: number[] = [];

  function handleEditorScroll(): void {
    view?.requestMeasure();
    if (Date.now() > preserveCursorAnchorUntil) {
      hasExplicitCursorAnchor = false;
      lastCursorAnchor = null;
    }
  }

  function scrollContainer(): HTMLElement | null {
    return host?.closest('.document-surface') as HTMLElement | null;
  }

  const baseTheme = EditorView.theme({
    '&': {
      height: '100%',
      fontSize: 'calc(15px * var(--editor-zoom, 1))',
      background: 'transparent',
      color: 'var(--ink)',
      overflow: 'hidden',
    },
    '.cm-scroller': {
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace',
      lineHeight: '1.68',
    },
    '.cm-gutters': {
      background: 'transparent',
      color: 'var(--muted)',
      border: 'none',
    },
    '.cm-activeLineGutter': {
      background: 'color-mix(in srgb, var(--accent) 7%, transparent)',
      color: 'var(--ink)',
    },
    '.cm-activeLine': {
      background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--accent)',
    },
    '.cm-selectionBackground': {
      background: 'var(--selection) !important',
    },
    '.cm-content': {
      padding: '20px 24px 48px 12px',
    },
    '.cm-line': {
      padding: '0 5px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 10px 0 8px',
    },
  });

  function buildExtensions() {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      bracketMatching(),
      markdown(),
      EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      highlightActiveLine(),
      EditorView.editable.of(editable),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if ((update.selectionSet || update.docChanged) && update.view.hasFocus) {
          rememberCursorAnchor();
        }
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      }),
      EditorView.domEventHandlers({
        pointerdown() {
          hasExplicitCursorAnchor = true;
        },
        pointerup() {
          hasExplicitCursorAnchor = true;
          requestAnimationFrame(rememberCursorAnchor);
        },
        keydown(event) {
          if (event.key === 'PageDown' || event.key === 'PageUp') {
            hasExplicitCursorAnchor = false;
            lastCursorAnchor = null;
          }
        },
        wheel() {
          hasExplicitCursorAnchor = false;
          lastCursorAnchor = null;
        },
      }),
      baseTheme,
    ];
  }

  export function insertText(text: string): void {
    if (!view) {
      return;
    }
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
      scrollIntoView: true,
    });
    view.focus();
  }

  export function getTopLine(): number {
    if (!view) {
      return 1;
    }
    return topLineFromScrollTop();
  }

  export function scrollToLine(line: number): boolean {
    if (!view) {
      return false;
    }
    const targetLine = Math.min(Math.max(1, line), view.state.doc.lines);
    preserveCursorAnchorUntil = Date.now() + 250;
    scrollToSourceLine(targetLine, 0);
    return true;
  }

  function readCursorAnchor(): CursorAnchor | null {
    if (!view) {
      return null;
    }
    const container = scrollContainer();
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head).number;
    const coords = view.coordsAtPos(head);
    if (!container || !coords) {
      return null;
    }
    const containerTop = container?.getBoundingClientRect().top ?? 0;
    const yOffset = coords.top - containerTop;
    if (yOffset < -24 || yOffset > container.clientHeight + 24) {
      return null;
    }
    return {
      line,
      yOffset,
    };
  }

  function rememberCursorAnchor(): void {
    if (!view) {
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
    if (!view) {
      return false;
    }
    hasExplicitCursorAnchor = true;
    preserveCursorAnchorUntil = Date.now() + 250;
    const container = scrollContainer();
    const targetLine = Math.min(Math.max(1, anchor.line), view.state.doc.lines);
    const target = view.state.doc.line(targetLine).from;

    view.dispatch({
      selection: { anchor: target },
    });
    scrollToSourceLine(targetLine, anchor.yOffset);
    view.requestMeasure();
    view.focus();

    requestAnimationFrame(() => {
      if (!view) {
        return;
      }
      const coords = view.coordsAtPos(view.state.selection.main.head);
      if (!coords) {
        return;
      }
      const containerTop = container?.getBoundingClientRect().top ?? view.scrollDOM.getBoundingClientRect().top;
      preserveCursorAnchorUntil = Date.now() + 250;
      view.scrollDOM.scrollTop += coords.top - containerTop - anchor.yOffset;
      view.requestMeasure();
      rememberCursorAnchor();
    });
    return true;
  }

  function topLineFromScrollTop(): number {
    if (!view) {
      return 1;
    }
    const scrollTop = view.scrollDOM.scrollTop;
    const block = view.lineBlockAtHeight(scrollTop);
    const measuredLine = view.state.doc.lineAt(block.from).number;
    if (measuredLine > 1 || scrollTop < 100) {
      return measuredLine;
    }

    const visibleLine = view.scrollDOM.querySelector('.cm-line') as HTMLElement | null;
    const lineHeight = visibleLine?.getBoundingClientRect().height || 25;
    const estimatedLine = Math.floor(scrollTop / lineHeight) + 1;
    return Math.min(Math.max(1, estimatedLine), view.state.doc.lines);
  }

  function scrollToSourceLine(line: number, yOffset: number): void {
    if (!view) {
      return;
    }
    const target = view.state.doc.line(line).from;
    clearPendingScrollTimers();
    const issueScroll = () => {
      if (!view) {
        return;
      }
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: 'start', yMargin: 0 }),
      });
      syncScrollTopToTarget(target, yOffset);
    };

    issueScroll();
    requestAnimationFrame(issueScroll);
    pendingScrollTimers = [window.setTimeout(issueScroll, 60), window.setTimeout(issueScroll, 160)];
  }

  function syncScrollTopToTarget(target: number, yOffset: number): void {
    if (!view) {
      return;
    }
    const blockTop = view.lineBlockAt(target).top;
    if (yOffset <= 0) {
      view.scrollDOM.scrollTop = Math.max(0, blockTop);
      return;
    }
    const coords = view.coordsAtPos(target);
    if (!coords) {
      view.scrollDOM.scrollTop = Math.max(0, blockTop);
      return;
    }
    const currentOffset = coords.top - view.scrollDOM.getBoundingClientRect().top;
    view.scrollDOM.scrollTop = Math.max(0, view.scrollDOM.scrollTop + currentOffset - yOffset);
  }

  function clearPendingScrollTimers(): void {
    for (const timer of pendingScrollTimers) {
      window.clearTimeout(timer);
    }
    pendingScrollTimers = [];
  }

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: buildExtensions(),
      }),
      parent: host,
    });
    view.scrollDOM.addEventListener('scroll', handleEditorScroll, { passive: true });
    onReady();
  });

  $: if (view && value !== view.state.doc.toString()) {
    hasExplicitCursorAnchor = false;
    lastCursorAnchor = null;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value,
      },
    });
  }

  $: if (host) {
    host.style.setProperty('--editor-zoom', String(zoom));
  }

  onDestroy(() => {
    clearPendingScrollTimers();
    view?.scrollDOM.removeEventListener('scroll', handleEditorScroll);
    view?.destroy();
  });
</script>

<div bind:this={host} class="editor-host" aria-label="Markdown editor"></div>
