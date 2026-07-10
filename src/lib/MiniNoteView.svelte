<script lang="ts">
  import { normalizeEscapedInlineMarkdown } from './markdownView';

  type MiniLine =
    | { kind: 'heading'; key: string; text: string; level: number }
    | { kind: 'task'; key: string; text: string; checked: boolean; lineIndex: number }
    | { kind: 'text'; key: string; text: string }
    | { kind: 'space'; key: string };

  export let value = '';
  export let onChange: (value: string) => void = () => {};

  function stripInline(markdown: string): string {
    return normalizeEscapedInlineMarkdown(markdown)
      .replace(/<span\s+[^>]*data-topplan-time=["'][^"']*["'][^>]*>(.*?)<\/span>/gi, '$1')
      .replace(/<input\s+[^>]*data-topplan-task[^>]*checked[^>]*>/gi, '[x]')
      .replace(/<input\s+[^>]*data-topplan-task[^>]*>/gi, '[ ]')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();
  }

  function parseLines(markdown: string): MiniLine[] {
    const parsed = markdown.split(/\r?\n/).map<MiniLine>((line, lineIndex) => {
      const key = `${lineIndex}-${line}`;
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        return { kind: 'heading', key, level: heading[1].length, text: stripInline(heading[2]) };
      }

      const task = line.match(/^(\s*[-*+]\s+\[)( |x|X)(\]\s*)(.*)$/);
      if (task) {
        return { kind: 'task', key, checked: task[2].toLowerCase() === 'x', text: stripInline(task[4]), lineIndex };
      }

      const text = stripInline(line.replace(/^\s*[-*+]\s+/, ''));
      return text ? { kind: 'text', key, text } : { kind: 'space', key };
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
    const lines = value.split(/\r?\n/);
    const line = lines[lineIndex] ?? '';
    lines[lineIndex] = line.replace(/^(\s*[-*+]\s+\[)( |x|X)(\]\s*)/, (_match, start: string, mark: string, end: string) => {
      return `${start}${mark.toLowerCase() === 'x' ? ' ' : 'x'}${end}`;
    });
    onChange(lines.join('\n'));
  }

  $: lines = parseLines(value);
</script>

<div class="mini-note-content" aria-label="TopPlan mini note">
  {#each lines as line}
    {#if line.kind === 'heading'}
      <div class:level-one={line.level <= 2} class="mini-heading">{line.text}</div>
    {:else if line.kind === 'task'}
      <div class:done={line.checked} class="mini-task">
        <input type="checkbox" checked={line.checked} onchange={() => toggleTask(line.lineIndex)} />
        <span>{line.text || ' '}</span>
      </div>
    {:else if line.kind === 'text'}
      <div class="mini-text">{line.text}</div>
    {:else}
      <div class="mini-space"></div>
    {/if}
  {/each}
</div>
