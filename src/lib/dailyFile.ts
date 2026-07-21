import { holiday } from '@kang8/chinese-holidays';
import type { PlanFile } from '../types';
import { isTopplanIndentComment, topplanVisualIndentLines } from './markdownView';

export const DAILY_MARKDOWN_TEMPLATE = `##### 一、今日计划

- [ ] 1.
- [ ] 2.

##### 二、近日完成

- [x] 1.
- [x] 2.
`;

const FIRST_OFFICIAL_CALENDAR_YEAR = 2006;
const LAST_OFFICIAL_CALENDAR_YEAR = 2026;
const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\](?:\s+|$))(.*)$/;
const NUMBER_PREFIX = /^(?:(?:\d+|[a-zA-Z])[.)、])\s*/;
const HEADING = /^(#{1,6})\s+(?:(?:一|二)[、.]\s*)?(今日计划|近日完成)\s*$/;
const ANY_HEADING = /^(#{1,6})\s+/;

type DailyTask = {
  line: string;
  prefixLines: string[];
  suffixLines: string[];
  indent: number;
  checked: boolean;
  children: DailyTask[];
};

type ParsedTaskSection = {
  preamble: string[];
  tasks: DailyTask[];
};

type SplitTask = {
  pending: DailyTask | null;
  completed: DailyTask | null;
};

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dailyFileName(date: Date): string {
  return `${formatLocalDate(date)}.md`;
}

export function isOfficialChineseWorkday(date: Date): boolean {
  const year = date.getFullYear();
  if (year < FIRST_OFFICIAL_CALENDAR_YEAR || year > LAST_OFFICIAL_CALENDAR_YEAR) {
    throw new Error(`缺少 ${year} 年中国法定节假日数据，已停止自动新建每日文档。请更新 TopPlan 的节假日日历数据。`);
  }
  return holiday.isWorkday(date);
}

export function parseDailyFileDate(name: string): Date | null {
  const match = name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/i);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return formatLocalDate(date) === `${match[1]}-${match[2]}-${match[3]}` ? date : null;
}

export function latestDailyFileBefore(files: PlanFile[], targetDate: Date): PlanFile | null {
  const target = formatLocalDate(targetDate);
  return (
    files
      .map((file) => ({ file, date: parseDailyFileDate(file.name) }))
      .filter((entry): entry is { file: PlanFile; date: Date } => entry.date !== null && formatLocalDate(entry.date) < target)
      .sort((left, right) => right.date.getTime() - left.date.getTime())[0]?.file ?? null
  );
}

function extractSection(markdown: string, sectionName: '今日计划' | '近日完成'): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.match(HEADING)?.[2] === sectionName);
  if (start < 0) {
    return [];
  }
  const headingLevel = lines[start].match(HEADING)?.[1].length ?? 6;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextHeading = lines[index].match(ANY_HEADING);
    if (nextHeading && nextHeading[1].length <= headingLevel) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function taskIndent(line: string, visualIndent: number): number {
  if (visualIndent > 0) {
    return visualIndent;
  }
  return line.length - line.trimStart().length;
}

function parseTaskSection(lines: string[]): ParsedTaskSection {
  const markdown = lines.join('\n');
  const visualIndentBySource = new Map(
    topplanVisualIndentLines(markdown).map((line) => [line.sourceLineIndex, line.visualIndent]),
  );
  const tasks: DailyTask[] = [];
  const preamble: string[] = [];
  const ancestors: DailyTask[] = [];
  let pendingLines: string[] = [];
  const lastTask = { current: null as DailyTask | null };

  lines.forEach((line, sourceLineIndex) => {
    const match = line.match(TASK_LINE);
    if (!match) {
      pendingLines.push(line);
      return;
    }

    let prefixStart = pendingLines.length;
    while (prefixStart > 0 && isTopplanIndentComment(pendingLines[prefixStart - 1])) {
      prefixStart -= 1;
    }
    const ordinaryPendingLines = pendingLines.slice(0, prefixStart);
    const prefixLines = lastTask.current ? [...pendingLines] : pendingLines.slice(prefixStart);
    if (!lastTask.current) {
      preamble.push(...ordinaryPendingLines);
    }
    pendingLines = [];

    const indent = taskIndent(line, visualIndentBySource.get(sourceLineIndex) ?? 0);
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].indent >= indent) {
      ancestors.pop();
    }
    const task: DailyTask = {
      line,
      prefixLines,
      suffixLines: [],
      indent,
      checked: match[2].toLowerCase() === 'x',
      children: [],
    };
    if (ancestors.length > 0) {
      ancestors[ancestors.length - 1].children.push(task);
    } else {
      tasks.push(task);
    }
    ancestors.push(task);
    lastTask.current = task;
  });

  if (lastTask.current) {
    lastTask.current.suffixLines.push(...pendingLines);
  } else {
    preamble.push(...pendingLines);
  }

  return { preamble, tasks };
}

function cloneTask(task: DailyTask): DailyTask {
  return {
    ...task,
    prefixLines: [...task.prefixLines],
    suffixLines: [...task.suffixLines],
    children: task.children.map(cloneTask),
  };
}

function rewriteChecked(line: string, checked: boolean): string {
  return line.replace(TASK_LINE, `$1${checked ? 'x' : ' '}$3$4`);
}

function forceTaskComplete(task: DailyTask): void {
  task.checked = true;
  task.line = rewriteChecked(task.line, true);
  task.children.forEach(forceTaskComplete);
}

function normalizeTaskCompletion(task: DailyTask): void {
  if (task.checked) {
    forceTaskComplete(task);
    return;
  }
  task.children.forEach(normalizeTaskCompletion);
  if (task.children.length > 0 && task.children.every((child) => child.checked)) {
    task.checked = true;
    task.line = rewriteChecked(task.line, true);
  }
}

function taskText(line: string): string {
  const content = line.match(TASK_LINE)?.[4] ?? '';
  return content
    .replace(NUMBER_PREFIX, '')
    .replace(/<span\s+[^>]*data-topplan-time=["'][^"']*["'][^>]*>.*?<\/span>/gi, '')
    .replace(/(?:\*\*|__|`)/g, '')
    .replace(/&nbsp;/gi, '')
    .trim();
}

function appendDateLabel(task: DailyTask, date: Date): void {
  const label = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  if (!task.line.includes(`data-topplan-time="${label}"`) && !task.line.includes(`data-topplan-time='${label}'`)) {
    task.line = `${task.line.trimEnd()} <span data-topplan-time="${label}">${label}</span>`;
  }
}

function appendDateToCompletedTasks(task: DailyTask, date: Date): void {
  if (task.checked) {
    appendDateLabel(task, date);
  }
  task.children.forEach((child) => appendDateToCompletedTasks(child, date));
}

function splitTask(task: DailyTask, date: Date): SplitTask {
  const normalized = cloneTask(task);
  normalizeTaskCompletion(normalized);
  if (!taskText(normalized.line) && normalized.children.length === 0) {
    return { pending: null, completed: null };
  }

  if (normalized.checked) {
    appendDateToCompletedTasks(normalized, date);
    return { pending: null, completed: normalized };
  }

  if (normalized.children.length === 0) {
    return { pending: normalized, completed: null };
  }

  const pendingChildren: DailyTask[] = [];
  const completedChildren: DailyTask[] = [];
  normalized.children.forEach((child) => {
    const split = splitTask(child, date);
    if (split.pending) {
      pendingChildren.push(split.pending);
    }
    if (split.completed) {
      completedChildren.push(split.completed);
    }
  });

  const pending = cloneTask(normalized);
  pending.checked = false;
  pending.line = rewriteChecked(pending.line, false);
  pending.children = pendingChildren;

  let completed: DailyTask | null = null;
  if (completedChildren.length > 0) {
    completed = cloneTask(normalized);
    completed.checked = false;
    completed.line = rewriteChecked(completed.line, false);
    completed.children = completedChildren;
  }

  return { pending, completed };
}

function renumberTaskLine(line: string, number: number, checked: boolean): string {
  const match = line.match(TASK_LINE);
  if (!match) {
    return line;
  }
  const content = match[4].trimStart().replace(NUMBER_PREFIX, '');
  return `${match[1]}${checked ? 'x' : ' '}${match[3]}${number}. ${content}`.trimEnd();
}

function renderTask(task: DailyTask, topLevelNumber?: number): string[] {
  const line = topLevelNumber === undefined ? rewriteChecked(task.line, task.checked) : renumberTaskLine(task.line, topLevelNumber, task.checked);
  return [
    ...task.prefixLines,
    line,
    ...task.children.flatMap((child) => renderTask(child)),
    ...task.suffixLines,
  ];
}

function compactSectionLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') {
    start += 1;
  }
  while (end > start && lines[end - 1].trim() === '') {
    end -= 1;
  }
  return lines.slice(start, end);
}

function renderSection(section: ParsedTaskSection, emptyLines: string[]): string {
  const content = [
    ...compactSectionLines(section.preamble),
    ...section.tasks.flatMap((task, index) => renderTask(task, index + 1)),
  ];
  return (content.length > 0 ? content : emptyLines).join('\n');
}

export function createDailyMarkdown(previousMarkdown: string | null, targetDate: Date): string {
  if (!previousMarkdown) {
    return DAILY_MARKDOWN_TEMPLATE;
  }

  const previousPlan = parseTaskSection(extractSection(previousMarkdown, '今日计划'));
  const previousCompleted = parseTaskSection(extractSection(previousMarkdown, '近日完成'));
  const pendingTasks: DailyTask[] = [];
  const newlyCompletedTasks: DailyTask[] = [];

  previousPlan.tasks.forEach((task) => {
    const split = splitTask(task, targetDate);
    if (split.pending) {
      pendingTasks.push(split.pending);
    }
    if (split.completed) {
      newlyCompletedTasks.push(split.completed);
    }
  });

  const completedTasks = previousCompleted.tasks
    .filter((task) => taskText(task.line) || task.children.length > 0)
    .map(cloneTask);
  const planSection: ParsedTaskSection = {
    preamble: previousPlan.preamble,
    tasks: pendingTasks,
  };
  const completedSection: ParsedTaskSection = {
    preamble: previousCompleted.preamble,
    tasks: [...newlyCompletedTasks, ...completedTasks],
  };

  return [
    '##### 一、今日计划',
    '',
    renderSection(planSection, ['- [ ] 1. ', '- [ ] 2. ']),
    '',
    '##### 二、近日完成',
    '',
    renderSection(completedSection, ['- [x] 1. ', '- [x] 2. ']),
    '',
  ].join('\n');
}
