import type { JSONContent } from '@tiptap/core';

export type SourceLineAnchor = {
  line: number;
  kind: 'block' | 'code';
};

export type RichSourceLineAnchor = SourceLineAnchor & {
  blank: boolean;
};

export type TopplanVisualIndentLine = {
  text: string;
  sourceLineIndex: number;
  visualIndent: number;
};

const TASK_MARKER_AT_LINE_START = /^(\s*)[-*+]\s+\[[ xX]\](?:\s+|$)/;
const EMPTY_TASK_ENTITY_LINE = /^(\s*[-*+]\s+\[[ xX]\]\s*)&nbsp;\s*$/i;
const BLANK_ENTITY_LINE = /^\s*(?:&nbsp;|\u00a0)\s*$/i;
const ACCIDENTAL_ORDERED_LIST_MARKER = /^(\s*\d+)([.)])(\s+)/;
const ACCIDENTAL_BULLET_LIST_MARKER = /^(\s*)([-*+])(\s+)/;
const TOPPLAN_INDENT_COMMENT = /^\s*<!--\s*topplan-indent:(\d+)\s*-->\s*$/i;
const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\](?:\s+|$))/;

type HierarchicalTaskLine = {
  sourceLineIndex: number;
  indent: number;
  checked: boolean;
  childIndexes: number[];
};

export function isTopplanIndentComment(line: string): boolean {
  return TOPPLAN_INDENT_COMMENT.test(line);
}

type FencedCode = {
  language: string | null;
  text: string;
};

function nodeText(node: JSONContent): string {
  if (typeof node.text === 'string') {
    return node.text;
  }
  return node.content?.map(nodeText).join('') ?? '';
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function unwrapFencedCode(text: string): FencedCode | null {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  let first = 0;
  let last = rawLines.length - 1;

  while (first <= last && rawLines[first].trim() === '') {
    first += 1;
  }
  while (last >= first && rawLines[last].trim() === '') {
    last -= 1;
  }
  if (last - first < 1) {
    return null;
  }

  const lines = rawLines.slice(first, last + 1);
  const indents = lines.filter((line) => line.trim() !== '').map(leadingSpaces);
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
  const outdented = lines.map((line) => (line.trim() === '' ? '' : line.slice(Math.min(leadingSpaces(line), commonIndent))));
  const opening = outdented[0].match(/^(`{3,}|~{3,})(\S*)?\s*$/);

  if (!opening) {
    return null;
  }

  const fence = opening[1];
  const closing = outdented[outdented.length - 1].trim();
  const closingPattern = new RegExp(`^\\${fence[0]}{${fence.length},}\\s*$`);

  if (!closingPattern.test(closing)) {
    return null;
  }

  return {
    language: opening[2] || null,
    text: outdented.slice(1, -1).join('\n'),
  };
}

function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph' && nodeText(node).trim() === '';
}

function withoutCodeAdjacentEmptyParagraphs(content: JSONContent[]): JSONContent[] {
  return content.filter((node, index, nodes) => {
    if (!isEmptyParagraph(node)) {
      return true;
    }
    return nodes[index - 1]?.type !== 'codeBlock' && nodes[index + 1]?.type !== 'codeBlock';
  });
}

function normalizeNode(node: JSONContent): JSONContent {
  const normalized: JSONContent = {
    ...node,
    attrs: node.attrs ? { ...node.attrs } : node.attrs,
    marks: node.marks ? [...node.marks] : node.marks,
    content: node.content?.map(normalizeNode),
  };

  if (normalized.type === 'codeBlock') {
    const fenced = unwrapFencedCode(nodeText(normalized));
    if (fenced) {
      normalized.attrs = {
        ...(normalized.attrs ?? {}),
        language: normalized.attrs?.language ?? fenced.language,
      };
      normalized.content = fenced.text ? [{ type: 'text', text: fenced.text }] : [];
    }
  }

  if (normalized.content) {
    normalized.content = withoutCodeAdjacentEmptyParagraphs(normalized.content);
  }

  return normalized;
}

export function normalizeMarkdownDocumentForRichEditor(doc: JSONContent): JSONContent {
  return normalizeNode(doc);
}

function normalizeEscapedInlineMarkdownSegment(text: string): string {
  return text
    .replace(/\\\*\\\*((?=\S)(?:[\s\S]*?\S))\\\*\\\*/g, '**$1**')
    .replace(/\\_\\_((?=\S)(?:[\s\S]*?\S))\\_\\_/g, '__$1__');
}

function normalizeEscapedInlineMarkdownLine(line: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < line.length) {
    const opening = line.slice(cursor).match(/`+/);
    if (!opening || opening.index === undefined) {
      output += normalizeEscapedInlineMarkdownSegment(line.slice(cursor));
      break;
    }

    const openingStart = cursor + opening.index;
    const marker = opening[0];
    output += normalizeEscapedInlineMarkdownSegment(line.slice(cursor, openingStart));

    const closingStart = line.indexOf(marker, openingStart + marker.length);
    if (closingStart === -1) {
      output += line.slice(openingStart);
      break;
    }

    const codeEnd = closingStart + marker.length;
    output += line.slice(openingStart, codeEnd);
    cursor = codeEnd;
  }

  return output;
}

export function normalizeEscapedInlineMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let activeFence: string | null = null;

  return lines
    .map((line) => {
      if (activeFence) {
        const closingFence = fenceMarker(line);
        if (closingFence?.startsWith(activeFence)) {
          activeFence = null;
        }
        return line;
      }

      const openingFence = fenceMarker(line);
      if (openingFence) {
        activeFence = openingFence;
        return line;
      }

      return normalizeEscapedInlineMarkdownLine(line);
    })
    .join('\n');
}

export function topplanVisualIndentLines(markdown: string): TopplanVisualIndentLine[] {
  const output: TopplanVisualIndentLine[] = [];
  let pendingIndent: number | null = null;

  markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((text, sourceLineIndex) => {
      const marker = text.match(TOPPLAN_INDENT_COMMENT);
      if (marker) {
        pendingIndent = Math.max(0, Number(marker[1]) || 0);
        return;
      }

      let visualIndent = 0;
      if (pendingIndent !== null && text.trim() !== '') {
        visualIndent = pendingIndent;
        pendingIndent = null;
      }
      output.push({ text, sourceLineIndex, visualIndent });
    });

  return output;
}

export function stripTopplanIndentComments(markdown: string): { markdown: string; indents: Map<number, number> } {
  const lines = topplanVisualIndentLines(markdown);
  const indents = new Map<number, number>();

  lines.forEach((line, index) => {
    if (line.visualIndent > 0) {
      indents.set(index + 1, line.visualIndent);
    }
  });

  return {
    markdown: lines.map((line) => line.text).join('\n'),
    indents,
  };
}

function hierarchicalTaskLines(markdown: string): HierarchicalTaskLine[] {
  const tasks: HierarchicalTaskLine[] = [];
  const ancestors: number[] = [];

  for (const line of topplanVisualIndentLines(markdown)) {
    const task = line.text.match(/^(\s*)[-*+]\s+\[([ xX])\](?:\s+|$)/);
    if (!task) {
      continue;
    }

    const indent = line.visualIndent > 0 ? line.visualIndent : task[1].length;
    while (ancestors.length > 0 && tasks[ancestors[ancestors.length - 1]].indent >= indent) {
      ancestors.pop();
    }

    const parentIndex = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
    const taskIndex = tasks.length;
    tasks.push({
      sourceLineIndex: line.sourceLineIndex,
      indent,
      checked: task[2].toLowerCase() === 'x',
      childIndexes: [],
    });
    if (parentIndex !== null) {
      tasks[parentIndex].childIndexes.push(taskIndex);
    }
    ancestors.push(taskIndex);
  }

  return tasks;
}

function writeTaskChecked(lines: string[], task: HierarchicalTaskLine, checked: boolean): void {
  lines[task.sourceLineIndex] = lines[task.sourceLineIndex].replace(TASK_LINE, `$1${checked ? 'x' : ' '}$3`);
  task.checked = checked;
}

function setTaskDescendantsChecked(lines: string[], tasks: HierarchicalTaskLine[], taskIndex: number, checked: boolean): void {
  for (const childIndex of tasks[taskIndex].childIndexes) {
    writeTaskChecked(lines, tasks[childIndex], checked);
    setTaskDescendantsChecked(lines, tasks, childIndex, checked);
  }
}

export function synchronizeTaskHierarchy(previousMarkdown: string, nextMarkdown: string): string {
  const previousTasks = new Map(hierarchicalTaskLines(previousMarkdown).map((task) => [task.sourceLineIndex, task]));
  const tasks = hierarchicalTaskLines(nextMarkdown);
  if (tasks.length === 0) {
    return nextMarkdown;
  }

  const lines = nextMarkdown.replace(/\r\n?/g, '\n').split('\n');
  const explicitlyChanged = new Set<number>();

  tasks.forEach((task, taskIndex) => {
    const previous = previousTasks.get(task.sourceLineIndex);
    if (previous && previous.checked !== task.checked) {
      explicitlyChanged.add(taskIndex);
    }
  });

  for (const taskIndex of explicitlyChanged) {
    if (tasks[taskIndex].childIndexes.length > 0) {
      setTaskDescendantsChecked(lines, tasks, taskIndex, tasks[taskIndex].checked);
    }
  }

  for (let taskIndex = tasks.length - 1; taskIndex >= 0; taskIndex -= 1) {
    const task = tasks[taskIndex];
    if (task.childIndexes.length === 0) {
      continue;
    }
    const allChildrenChecked = task.childIndexes.every((childIndex) => tasks[childIndex].checked);
    if (task.checked !== allChildrenChecked) {
      writeTaskChecked(lines, task, allChildrenChecked);
    }
  }

  return lines.join('\n');
}

export function toggleTaskCheckboxAtLine(markdown: string, sourceLineIndex: number): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  if (sourceLineIndex < 0 || sourceLineIndex >= lines.length || !TASK_LINE.test(lines[sourceLineIndex])) {
    return markdown;
  }
  TASK_LINE.lastIndex = 0;
  const toggled = lines[sourceLineIndex].replace(TASK_LINE, (_match, start: string, checked: string, end: string) => {
    return `${start}${checked.toLowerCase() === 'x' ? ' ' : 'x'}${end}`;
  });
  lines[sourceLineIndex] = toggled;
  return synchronizeTaskHierarchy(markdown, lines.join('\n'));
}

export function isBlankishMarkdownLine(line: string): boolean {
  return line.trim() === '' || BLANK_ENTITY_LINE.test(line);
}

function escapeAccidentalListMarker(line: string): string {
  if (ACCIDENTAL_ORDERED_LIST_MARKER.test(line)) {
    return line.replace(ACCIDENTAL_ORDERED_LIST_MARKER, '$1\\$2$3');
  }
  if (ACCIDENTAL_BULLET_LIST_MARKER.test(line)) {
    return line.replace(ACCIDENTAL_BULLET_LIST_MARKER, '$1\\$2$3');
  }
  return line;
}

export function toggleTaskMarkerOnLine(
  markdown: string,
  lineNumber: number,
  { preserveEmptyParagraph = false }: { preserveEmptyParagraph?: boolean } = {}
): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const index = Math.min(Math.max(1, lineNumber), Math.max(lines.length, 1)) - 1;
  const line = lines[index] ?? '';

  const taskMarker = line.match(TASK_MARKER_AT_LINE_START);
  if (taskMarker) {
    const remainingText = line.slice(taskMarker[0].length);
    if (isBlankishMarkdownLine(remainingText)) {
      lines[index] = preserveEmptyParagraph ? `${taskMarker[1]}&nbsp;` : taskMarker[1];
      return lines.join('\n');
    }
    lines[index] = escapeAccidentalListMarker(`${taskMarker[1]}${remainingText}`);
    return lines.join('\n');
  }

  lines[index] = isBlankishMarkdownLine(line) ? '- [ ] ' : line.replace(/^(\s*)/, '$1- [ ] ');
  return lines.join('\n');
}

export function normalizeSerializedTaskMarkers(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(EMPTY_TASK_ENTITY_LINE, '$1'))
    .join('\n');
}

function fenceMarker(line: string): string | null {
  return line.trimStart().match(/^(`{3,}|~{3,})/)?.[1] ?? null;
}

function isFenceLine(line: string): boolean {
  return fenceMarker(line) !== null;
}

function isBlockStartLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    /^(#{1,6})\s+/.test(trimmed) ||
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    isFenceLine(line)
  );
}

export function sourceLineAnchorsForRichBlocks(markdown: string): RichSourceLineAnchor[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const anchors: RichSourceLineAnchor[] = [];
  let inParagraph = false;
  let activeFence: string | null = null;

  lines.forEach((line, index) => {
    if (activeFence) {
      const closingFence = fenceMarker(line);
      if (closingFence?.startsWith(activeFence)) {
        activeFence = null;
      }
      return;
    }

    const openingFence = fenceMarker(line);
    if (openingFence) {
      anchors.push({ line: index + 1, kind: 'code', blank: false });
      activeFence = openingFence;
      inParagraph = false;
      return;
    }

    if (isBlankishMarkdownLine(line)) {
      anchors.push({ line: index + 1, kind: 'block', blank: true });
      inParagraph = false;
      return;
    }

    if (!inParagraph || isBlockStartLine(line)) {
      anchors.push({ line: index + 1, kind: 'block', blank: false });
    }
    inParagraph = !isBlockStartLine(line);
  });

  return anchors;
}

export function sourceLineAnchors(markdown: string): SourceLineAnchor[] {
  return sourceLineAnchorsForRichBlocks(markdown)
    .filter((anchor) => !anchor.blank)
    .map(({ line, kind }) => ({ line, kind }));
}
