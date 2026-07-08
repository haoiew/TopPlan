import type { JSONContent } from '@tiptap/core';

export type SourceLineAnchor = {
  line: number;
  kind: 'block' | 'code';
};

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

export function sourceLineAnchors(markdown: string): SourceLineAnchor[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const anchors: SourceLineAnchor[] = [];
  let inParagraph = false;
  let activeFence: string | null = null;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      inParagraph = false;
      return;
    }

    if (activeFence) {
      const closingFence = fenceMarker(line);
      if (closingFence?.startsWith(activeFence)) {
        activeFence = null;
      }
      return;
    }

    const openingFence = fenceMarker(line);
    if (openingFence) {
      anchors.push({ line: index + 1, kind: 'code' });
      activeFence = openingFence;
      inParagraph = false;
      return;
    }

    if (!inParagraph || isBlockStartLine(line)) {
      anchors.push({ line: index + 1, kind: 'block' });
    }
    inParagraph = !isBlockStartLine(line);
  });

  return anchors;
}
