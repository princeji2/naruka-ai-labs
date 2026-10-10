// Type-safety scanner (rules `any-type` and `ts-directive`, Requirement 9.6).
// Flags `: any`, `as any`, `<any>`, `any[]`, `Array<any>`, `any` as a generic argument
// (`Record<string, any>`), and the comment directives @ts-ignore, @ts-expect-error, @ts-nocheck.
// Ignores identifiers that contain the letters (`company`, `anyOf`), strings, and comments that
// only mention the words in prose. Pure: text in, hits out.

import { createLocator, getRegions, makeHit, sortHits } from './scan-util.mjs';

/** @typedef {import('./scan-util.mjs').Hit} Hit */
/** @typedef {import('./scan-util.mjs').SourceKind} SourceKind */

const ANY_RE = /(?<![\w$.])any(?![\w$])/g;
const DIRECTIVE_RE = /^@ts-(?:ignore|expect-error|nocheck)\b/;

/**
 * Is the index inside an unclosed `<...>` generic list? Walks back over the same statement.
 * @param {string} code
 * @param {number} index
 */
function insideAngleBrackets(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0 && index - i < 400; i -= 1) {
    const ch = code[i];
    if (ch === ';' || ch === '{' || ch === '}' || ch === '(') return false;
    if (ch === '>' && code[i - 1] !== '=') depth += 1;
    else if (ch === '<') {
      if (depth === 0) return true;
      depth -= 1;
    }
  }
  return false;
}

/**
 * Finds unsafe typings in TypeScript-like source: `.ts`, `.tsx`, and the frontmatter and
 * `<script>` blocks of `.astro` files.
 * @param {string} text
 * @param {SourceKind} kind 'ts' | 'tsx' | 'astro' | 'js'
 * @returns {Hit[]}
 */
export function scanTypes(text, kind) {
  const regions = getRegions(text, kind);
  if (regions.lex === null) return [];
  const locate = createLocator(text);
  const { code, comments } = regions.lex;
  /** @type {Hit[]} */
  const hits = [];

  for (const m of code.matchAll(ANY_RE)) {
    const i = m.index;
    let b = i - 1;
    while (b >= 0 && /\s/.test(code[b])) b -= 1;
    let a = i + 3;
    while (a < code.length && /\s/.test(code[a])) a += 1;
    const before = code[b];
    const after = code[a];
    const wordBefore = /(?:^|[^\w$])as$/.test(code.slice(Math.max(0, b - 2), b + 1));
    let form = null;

    if (after === '[' && /^\[\s*\]/.test(code.slice(a))) form = 'any[]';
    else if (before === ':' && code[b - 1] !== ':') form = ': any';
    else if (wordBefore) form = 'as any';
    else if (before === '<' && (after === '>' || after === ',' || after === '[' || after === '|' || after === '&')) {
      form = '<any>';
    } else if (before === ',' && (after === '>' || after === ',' || after === '|' || after === '&') && insideAngleBrackets(code, i)) {
      form = 'generic any';
    }
    if (form !== null) hits.push(makeHit('any-type', locate, i, 'any', form));
  }

  for (const c of comments) {
    // A directive is a comment (or a line of a block comment) that starts with the directive.
    const body = c.text.startsWith('//') ? c.text.slice(2) : c.text.slice(2, c.text.endsWith('*/') ? -2 : undefined);
    let offset = c.start + 2;
    for (const line of body.split('\n')) {
      const lead = /^[\s*/]*/.exec(line)[0].length;
      const rest = line.slice(lead);
      const m = DIRECTIVE_RE.exec(rest);
      if (m) hits.push(makeHit('ts-directive', locate, offset + lead, m[0]));
      offset += line.length + 1;
    }
  }
  return sortHits(hits);
}
