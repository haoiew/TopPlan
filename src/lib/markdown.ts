import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/common';
import type Token from 'markdown-it/lib/token.mjs';
import type { ImageReference } from '../types';
import { localAssetUrl } from './tauriClient';

const markdownUtils = new MarkdownIt().utils;
type MarkdownRenderEnv = {
  imageMap?: Map<string, string>;
};

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(code: string, language: string): string {
    const canHighlight = language && hljs.getLanguage(language);
    const result = canHighlight ? hljs.highlight(code, { language }).value : markdownUtils.escapeHtml(code);
    return `<pre class="hljs"><code>${result}</code></pre>`;
  },
})
  .use(taskLists, { enabled: true, label: true, labelAfter: true })
  .use(footnote)
  .use(anchor, {
    permalink: anchor.permalink.linkInsideHeader({
      symbol: '#',
      placement: 'after',
      class: 'heading-anchor',
    }),
  });

md.renderer.rules.image = (tokens, idx, options, env: MarkdownRenderEnv, self) => {
  const token = tokens[idx];
  const rawSrc = getTokenAttr(token, 'src');

  if (rawSrc) {
    const converted = env.imageMap?.get(rawSrc);
    if (converted) {
      token.attrSet('src', converted);
    } else if (!rawSrc.startsWith('http://') && !rawSrc.startsWith('https://') && !rawSrc.startsWith('data:')) {
      token.attrJoin('class', 'missing-image');
      token.attrSet('data-missing-src', rawSrc);
    }
  }

  return self.renderToken(tokens, idx, options);
};

function getTokenAttr(token: Token, name: string): string | null {
  const value = token.attrGet(name);
  return typeof value === 'string' ? value : null;
}

export function renderMarkdown(content: string, currentFile: string | null, references: ImageReference[]): string {
  const imageMap = new Map<string, string>();

  for (const reference of references) {
    if (reference.sourceFile !== currentFile || !reference.resolvedPath) {
      continue;
    }
    if (reference.status === 'ok' || reference.status === 'external') {
      imageMap.set(reference.rawPath, localAssetUrl(reference.resolvedPath));
    }
  }

  return md.render(content, { imageMap });
}
