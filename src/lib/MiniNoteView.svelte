<script lang="ts">
  import { normalizeEscapedInlineMarkdown, toggleTaskCheckboxAtLine, topplanVisualIndentLines } from './markdownView';

  type MiniLine =
    | { kind: 'heading'; key: string; text: string; level: number; visualIndent: number }
    | { kind: 'task'; key: string; text: string; checked: boolean; lineIndex: number; visualIndent: number }
    | { kind: 'text'; key: string; text: string; visualIndent: number }
    | { kind: 'space'; key: string; visualIndent: number };

  export let value = '';
  export let onChange: (value: string) => void = () => {};

  function stripInline(markdown: string): string {
    return normalizeEscapedInlineMarkdown(markdown)
      .replace(/<span\s+[^>]*data-topplan-time=["'][^"']*["'][^>]*>.*?<\/span>/gi, '')
      .replace(/<input\s+[^>]*data-topplan-task[^>]*checked[^>]*>/gi, '[x]')
      .replace(/<input\s+[^>]*data-topplan-task[^>]*>/gi, '[ ]')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();
  }

  function parseLines(markdown: string): MiniLine[] {
    const parsed = topplanVisualIndentLines(markdown).map<MiniLine>(({ text: line, sourceLineIndex: lineIndex, visualIndent }) => {
      const key = `${lineIndex}-${line}`;
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        return { kind: 'heading', key, level: heading[1].length, text: stripInline(heading[2]), visualIndent };
      }

      const task = line.match(/^(\s*[-*+]\s+\[)( |x|X)(\]\s*)(.*)$/);
      if (task) {
        return { kind: 'task', key, checked: task[2].toLowerCase() === 'x', text: stripInline(task[4]), lineIndex, visualIndent };
      }

      const text = stripInline(line.replace(/^\s*[-*+]\s+/, ''));
      return text ? { kind: 'text', key, text, visualIndent } : { kind: 'space', key, visualIndent };
    });
    while (parsed[0]?.kind === 'space') {
      parsed.shift();
    }
    while (parsed[parsed.length - 1]?.kind === 'space') {
      parsed.pop();
    }
    return parsed;
  }

  function toggleTask(lineIndex: number): void {
    onChange(toggleTaskCheckboxAtLine(value, lineIndex));
  }

  $: lines = parseLines(value);
</script>

<div class="mini-note-content" aria-label="TopPlan mini note">
  {#each lines as line}
    {#if line.kind === 'heading'}
      <div class:level-one={line.level <= 2} class="mini-heading" style={`margin-left: ${line.visualIndent}em`}>{line.text}</div>
    {:else if line.kind === 'task'}
      <div class:done={line.checked} class="mini-task" style={`margin-left: ${line.visualIndent}em`}>
        <input type="checkbox" checked={line.checked} onchange={() => toggleTask(line.lineIndex)} />
        <span>{line.text || ' '}</span>
      </div>
    {:else if line.kind === 'text'}
      <div class="mini-text" style={`margin-left: ${line.visualIndent}em`}>{line.text}</div>
    {:else}
      <div class="mini-space"></div>
    {/if}
  {/each}
</div>
