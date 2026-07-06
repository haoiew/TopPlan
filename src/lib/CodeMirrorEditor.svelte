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
  export let onChange: (value: string) => void = () => {};

  let host: HTMLDivElement;
  let view: EditorView | null = null;

  const baseTheme = EditorView.theme({
    '&': {
      height: '100%',
      fontSize: '14px',
      background: 'transparent',
      color: 'var(--ink)',
    },
    '.cm-scroller': {
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      lineHeight: '1.58',
    },
    '.cm-gutters': {
      background: 'transparent',
      color: 'var(--muted)',
      border: 'none',
    },
    '.cm-activeLineGutter': {
      background: 'var(--surface-2)',
      color: 'var(--ink)',
    },
    '.cm-activeLine': {
      background: 'var(--surface-2)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--accent)',
    },
    '.cm-selectionBackground': {
      background: 'var(--selection) !important',
    },
    '.cm-content': {
      padding: '14px 16px 36px 8px',
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
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      highlightActiveLine(),
      EditorView.editable.of(editable),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      }),
      baseTheme,
    ];
  }

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: buildExtensions(),
      }),
      parent: host,
    });
  });

  $: if (view && value !== view.state.doc.toString()) {
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value,
      },
    });
  }

  onDestroy(() => {
    view?.destroy();
  });
</script>

<div bind:this={host} class="editor-host" aria-label="Markdown editor"></div>

