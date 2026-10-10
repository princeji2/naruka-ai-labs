// Shared helpers for the source-scan rule libraries (scan-colours, scan-motion, scan-types, scan-rules).
// Pure functions over strings. Node built-ins are not even needed; there is no I/O here.
//
// Every "view" produced here has exactly the same length as the input and keeps newlines in place,
// so an index into a view is an index into the original text and line numbers stay correct.

/** @typedef {{ rule: string, line: number, column: number, index: number, match: string, detail?: string }} Hit */
/** @typedef {'css' | 'astro' | 'ts' | 'tsx' | 'js' | 'html'} SourceKind */

// ---------------------------------------------------------------------------
// Locations and hits
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {(index: number) => { line: number, column: number }} 1-based line and column
 */
export function createLocator(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: index - starts[lo] + 1 };
  };
}

/**
 * @param {string} rule
 * @param {(index: number) => { line: number, column: number }} locate
 * @param {number} index
 * @param {string} match
 * @param {string} [detail]
 * @returns {Hit}
 */
export function makeHit(rule, locate, index, match, detail) {
  const { line, column } = locate(index);
  return detail === undefined ? { rule, line, column, index, match } : { rule, line, column, index, match, detail };
}

/**
 * Sorts by position and drops exact duplicates.
 * @param {Hit[]} hits
 * @returns {Hit[]}
 */
export function sortHits(hits) {
  const sorted = [...hits].sort((a, b) => a.index - b.index || a.rule.localeCompare(b.rule));
  return sorted.filter((h, i) => i === 0 || h.index !== sorted[i - 1].index || h.match !== sorted[i - 1].match || h.rule !== sorted[i - 1].rule);
}

/**
 * Maps a file path to a source kind.
 * @param {string} file
 * @returns {SourceKind | null}
 */
export function kindOfFile(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.astro')) return 'astro';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) return 'tsx';
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return 'ts';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return null;
}

/** Normalises a path to forward slashes with no leading `./`. @param {string} file */
export function normalisePath(file) {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Replaces every character except line breaks with a space. @param {string} s */
export function blankText(s) {
  return s.replace(/[^\r\n]/g, ' ');
}

/**
 * A view with only the given ranges kept; everything else is blanked.
 * @param {string} text
 * @param {Array<[number, number]>} ranges
 */
export function keepRanges(text, ranges) {
  const out = blankText(text).split('');
  for (const [a, b] of ranges) {
    for (let i = a; i < b; i += 1) out[i] = text[i];
  }
  return out.join('');
}

/**
 * A view with the given ranges blanked.
 * @param {string} text
 * @param {Array<[number, number]>} ranges
 */
export function blankRanges(text, ranges) {
  const out = text.split('');
  for (const [a, b] of ranges) {
    for (let i = a; i < b; i += 1) {
      if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
    }
  }
  return out.join('');
}

/** Blanks CSS block comments. @param {string} text */
export function maskCssComments(text) {
  return text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (m) => blankText(m));
}

/** Blanks `url(...)` bodies and quoted strings in a CSS value, so colour-like text inside them is ignored. @param {string} value */
export function blankCssNoise(value) {
  return value
    .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi, (m) => blankText(m))
    .replace(/"[^"\r\n]*"|'[^'\r\n]*'/g, (m) => blankText(m));
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript lexing (comments, strings, templates, regex literals)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ start: number, end: number, text: string }} CommentToken
 * @typedef {{ start: number, end: number, quote: string, content: string }} StringToken
 * @typedef {{ code: string, noComments: string, comments: CommentToken[], strings: StringToken[] }} JsLex
 */

const REGEX_PREV_WORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof',
]);
// `)` `]` `}` `<` are deliberately absent: they are far more often followed by a division or a closing JSX tag.
const REGEX_PREV_PUNCT = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '>', '~', '^']);

/**
 * Lexes JavaScript or TypeScript just enough to tell code from comments, strings and regex literals.
 * `code` has comments, string contents (quotes stay), template text and regex bodies blanked.
 * `noComments` has only comments blanked (strings stay readable).
 * Unterminated strings end at the line break, so a stray apostrophe in JSX text cannot swallow the file.
 * @param {string} text
 * @returns {JsLex}
 */
export function lexJs(text) {
  const n = text.length;
  const code = text.split('');
  const noComments = text.split('');
  /** @type {CommentToken[]} */
  const comments = [];
  /** @type {StringToken[]} */
  const strings = [];
  let prevSig = '';
  let prevWord = '';

  /** @param {string[]} arr @param {number} a @param {number} b */
  function blank(arr, a, b) {
    for (let k = a; k < b; k += 1) {
      if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' ';
    }
  }

  /** @param {number} start @param {boolean} untilBrace @returns {number} */
  function run(start, untilBrace) {
    let i = start;
    let depth = 0;
    while (i < n) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i += 1;
        continue;
      }
      if (ch === '/' && next === '/') {
        let j = i + 2;
        while (j < n && text[j] !== '\n' && text[j] !== '\r') j += 1;
        comments.push({ start: i, end: j, text: text.slice(i, j) });
        blank(code, i, j);
        blank(noComments, i, j);
        i = j;
        continue;
      }
      if (ch === '/' && next === '*') {
        const close = text.indexOf('*/', i + 2);
        const j = close === -1 ? n : close + 2;
        comments.push({ start: i, end: j, text: text.slice(i, j) });
        blank(code, i, j);
        blank(noComments, i, j);
        i = j;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < n && text[j] !== ch && text[j] !== '\n' && text[j] !== '\r') {
          j += text[j] === '\\' ? 2 : 1;
        }
        const end = j < n && text[j] === ch ? j + 1 : Math.min(j, n);
        const closed = end > i + 1 && text[end - 1] === ch;
        const contentEnd = closed ? end - 1 : end;
        strings.push({ start: i, end, quote: ch, content: text.slice(i + 1, contentEnd) });
        blank(code, i + 1, contentEnd);
        prevSig = ch;
        prevWord = '';
        i = end;
        continue;
      }
      if (ch === '`') {
        let j = i + 1;
        let segStart = i + 1;
        while (j < n && text[j] !== '`') {
          if (text[j] === '\\') {
            j += 2;
          } else if (text[j] === '$' && text[j + 1] === '{') {
            blank(code, segStart, j + 2);
            const savedSig = prevSig;
            const savedWord = prevWord;
            prevSig = '{';
            prevWord = '';
            const close = run(j + 2, true);
            prevSig = savedSig;
            prevWord = savedWord;
            blank(code, close, close + 1);
            j = close + 1;
            segStart = j;
          } else {
            j += 1;
          }
        }
        const end = Math.min(j, n);
        blank(code, segStart, end);
        strings.push({ start: i, end: Math.min(end + 1, n), quote: '`', content: text.slice(i + 1, end) });
        prevSig = '`';
        prevWord = '';
        i = Math.min(end + 1, n);
        continue;
      }
      if (ch === '/') {
        const regexAllowed =
          prevSig === '' || REGEX_PREV_PUNCT.has(prevSig) || (prevSig === 'a' && REGEX_PREV_WORDS.has(prevWord));
        if (regexAllowed) {
          let j = i + 1;
          let inClass = false;
          let ok = false;
          while (j < n && text[j] !== '\n' && text[j] !== '\r') {
            const c = text[j];
            if (c === '\\') {
              j += 2;
              continue;
            }
            if (c === '[') inClass = true;
            else if (c === ']') inClass = false;
            else if (c === '/' && !inClass) {
              ok = true;
              break;
            }
            j += 1;
          }
          if (ok) {
            blank(code, i + 1, j);
            j += 1;
            while (j < n && /[a-z]/i.test(text[j])) j += 1;
            prevSig = 'x';
            prevWord = '';
            i = j;
            continue;
          }
        }
        prevSig = '/';
        prevWord = '';
        i += 1;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i + 1;
        while (j < n && /[\w$]/.test(text[j])) j += 1;
        prevWord = text.slice(i, j);
        prevSig = 'a';
        i = j;
        continue;
      }
      if (untilBrace) {
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          if (depth === 0) return i;
          depth -= 1;
        }
      }
      prevSig = ch;
      prevWord = '';
      i += 1;
    }
    return n;
  }

  run(0, false);
  return { code: code.join(''), noComments: noComments.join(''), comments, strings };
}

/**
 * Index of the bracket that closes the one at `open`. Works on a lexed `code` view (strings blanked).
 * @param {string} code
 * @param {number} open
 * @returns {number} the closing index, or -1
 */
export function matchingBracket(code, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') stack.push(pairs[ch]);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/**
 * Splits `[start, end)` of a lexed `code` view at top-level commas.
 * @param {string} code
 * @param {number} start
 * @param {number} end
 * @returns {Array<{ start: number, end: number }>}
 */
export function splitTopLevel(code, start, end) {
  const parts = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < end; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push({ start: from, end: i });
      from = i + 1;
    }
  }
  parts.push({ start: from, end });
  return parts;
}

// ---------------------------------------------------------------------------
// CSS declarations
// ---------------------------------------------------------------------------

/**
 * @typedef {{ prop: string, value: string, index: number, valueIndex: number, ancestors: string[] }} CssDeclaration
 */

/**
 * Walks CSS (comments already masked) and returns every `prop: value` declaration with the preludes
 * of the blocks it sits in. Works for style-attribute bodies too. Semicolons and braces inside
 * parentheses and strings (for example `url(data:...;base64,...)`) are not statement boundaries.
 * @param {string} text
 * @param {number} [base] added to every returned index
 * @returns {CssDeclaration[]}
 */
export function cssDeclarations(text, base = 0) {
  const n = text.length;
  /** @type {CssDeclaration[]} */
  const out = [];
  /** @type {string[]} */
  const stack = [];
  let stmtStart = 0;
  let paren = 0;

  /** @param {number} a @param {number} b */
  function emit(a, b) {
    const raw = text.slice(a, b);
    const colon = raw.indexOf(':');
    if (colon < 0) return;
    const propRaw = raw.slice(0, colon);
    const prop = propRaw.trim();
    if (!/^-{0,2}[A-Za-z_][\w-]*$/.test(prop)) return;
    const lead = propRaw.length - propRaw.trimStart().length;
    out.push({
      prop: prop.startsWith('--') ? prop : prop.toLowerCase(),
      value: raw.slice(colon + 1),
      index: base + a + lead,
      valueIndex: base + a + colon + 1,
      ancestors: [...stack],
    });
  }

  for (let i = 0; i < n; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && text[j] !== ch && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (ch === '(') paren += 1;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (paren === 0) {
      if (ch === '{') {
        stack.push(text.slice(stmtStart, i).trim());
        stmtStart = i + 1;
      } else if (ch === ';') {
        emit(stmtStart, i);
        stmtStart = i + 1;
      } else if (ch === '}') {
        emit(stmtStart, i);
        stack.pop();
        stmtStart = i + 1;
      }
    }
  }
  emit(stmtStart, n);
  return out;
}

/**
 * Splits a CSS value at top-level occurrences of `separator` (parentheses and strings are respected).
 * @param {string} value
 * @param {',' | ' '} separator `' '` splits on runs of whitespace
 * @returns {Array<{ text: string, offset: number }>}
 */
export function splitCssValue(value, separator) {
  const parts = [];
  let depth = 0;
  let from = 0;
  const push = (end) => {
    const raw = value.slice(from, end);
    const text = raw.trim();
    if (text) parts.push({ text, offset: from + (raw.length - raw.trimStart().length) });
  };
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (separator === ',' && ch === ',') {
        push(i);
        from = i + 1;
      } else if (separator === ' ' && /\s/.test(ch)) {
        push(i);
        from = i + 1;
      }
    }
  }
  push(value.length);
  return parts;
}

// ---------------------------------------------------------------------------
// Astro files
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   frontmatter: [number, number] | null,
 *   scripts: Array<{ start: number, end: number, attrs: string }>,
 *   styles: Array<{ start: number, end: number, attrs: string }>,
 *   markup: string,
 * }} AstroParts
 */

/**
 * Finds the frontmatter, `<script>` and `<style>` blocks of an `.astro` file.
 * `markup` is the file with the frontmatter, the inside of script and style blocks, and HTML comments blanked.
 * @param {string} text
 * @returns {AstroParts}
 */
export function splitAstro(text) {
  /** @type {[number, number] | null} */
  let frontmatter = null;
  const open = /^\uFEFF?\s*---[ \t]*\r?\n/.exec(text);
  if (open) {
    const bodyStart = open[0].length;
    let from = bodyStart - 1;
    for (;;) {
      const idx = text.indexOf('\n---', from);
      if (idx === -1) break;
      const rest = /^[ \t]*(\r?\n|$)/.exec(text.slice(idx + 4));
      if (rest) {
        frontmatter = [bodyStart, idx];
        break;
      }
      from = idx + 1;
    }
  }

  /** @type {Array<[number, number]>} */
  const pre = [];
  if (frontmatter) pre.push([0, frontmatter[1] + 4]);
  let view = blankRanges(text, pre);
  view = view.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => blankText(m));

  /** @param {string} tag */
  const blocks = (tag) => {
    const re = new RegExp(`<${tag}\\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
    const found = [];
    let m;
    while ((m = re.exec(view)) !== null) {
      const start = m.index + 1 + tag.length + m[1].length + 1;
      found.push({ start, end: start + m[2].length, attrs: m[1] });
    }
    return found;
  };
  const scripts = blocks('script');
  const styles = blocks('style');
  const markup = blankRanges(view, [...scripts, ...styles].map((b) => [b.start, b.end]));
  return { frontmatter, scripts, styles, markup };
}

/**
 * The code (frontmatter plus script blocks) of an Astro file as one view.
 * @param {string} text
 * @param {AstroParts} parts
 */
export function astroCodeView(text, parts) {
  const ranges = [];
  if (parts.frontmatter) ranges.push(parts.frontmatter);
  for (const s of parts.scripts) ranges.push([s.start, s.end]);
  return keepRanges(text, ranges);
}

/**
 * The style blocks of an Astro file as one CSS view (comments masked).
 * @param {string} text
 * @param {AstroParts} parts
 */
export function astroStyleView(text, parts) {
  return maskCssComments(keepRanges(text, parts.styles.map((s) => [s.start, s.end])));
}

// ---------------------------------------------------------------------------
// Markup tags (Astro templates, HTML)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ name: string, value: string, valueStart: number, kind: 'string' | 'expr' | 'bare' | 'none' }} TagAttr
 * @typedef {{ name: string, start: number, attrs: TagAttr[] }} Tag
 */

/**
 * Index of the `}` that closes the `{` at `open`, skipping quoted strings and template literals.
 * @param {string} text
 * @param {number} open
 */
function matchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      i = j;
    } else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/**
 * Tokenises the opening tags of a markup view (use `AstroParts.markup` for Astro files).
 * Handles quoted values, `{expression}` values, bare values and spread attributes.
 * @param {string} markup
 * @returns {Tag[]}
 */
export function iterTags(markup) {
  const n = markup.length;
  /** @type {Tag[]} */
  const tags = [];
  const re = /<([A-Za-z][\w:.-]*)/g;
  let m;
  while ((m = re.exec(markup)) !== null) {
    const name = m[1];
    let i = m.index + m[0].length;
    /** @type {TagAttr[]} */
    const attrs = [];
    while (i < n) {
      while (i < n && /\s/.test(markup[i])) i += 1;
      const c = markup[i];
      if (c === undefined || c === '>') break;
      if (c === '/') {
        i += 1;
        continue;
      }
      if (c === '{') {
        i = matchingBrace(markup, i) + 1;
        continue;
      }
      const nameMatch = /^[^\s=>/"'{}]+/.exec(markup.slice(i, i + 200));
      if (!nameMatch) {
        i += 1;
        continue;
      }
      const attrName = nameMatch[0].toLowerCase();
      i += nameMatch[0].length;
      let j = i;
      while (j < n && /\s/.test(markup[j])) j += 1;
      if (markup[j] !== '=') {
        attrs.push({ name: attrName, value: '', valueStart: i, kind: 'none' });
        continue;
      }
      j += 1;
      while (j < n && /\s/.test(markup[j])) j += 1;
      const q = markup[j];
      if (q === '"' || q === "'" || q === '`') {
        let k = j + 1;
        while (k < n && markup[k] !== q) k += 1;
        attrs.push({ name: attrName, value: markup.slice(j + 1, k), valueStart: j + 1, kind: 'string' });
        i = k + 1;
      } else if (q === '{') {
        const close = matchingBrace(markup, j);
        attrs.push({ name: attrName, value: markup.slice(j + 1, close), valueStart: j + 1, kind: 'expr' });
        i = close + 1;
      } else {
        const bare = /^[^\s>]+/.exec(markup.slice(j, j + 500));
        const value = bare ? bare[0] : '';
        attrs.push({ name: attrName, value, valueStart: j, kind: 'bare' });
        i = j + value.length;
      }
    }
    tags.push({ name: name.toLowerCase(), start: m.index, attrs });
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Regions per file kind
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   lex: JsLex | null,          // lexed code (ts, tsx, js; Astro frontmatter plus scripts)
 *   css: string | null,         // comment-masked CSS (css files; Astro style blocks)
 *   markup: string | null,      // markup view (Astro templates, html)
 *   astro: AstroParts | null,
 * }} Regions
 */

/**
 * Splits a source file into the regions each scanner cares about.
 * @param {string} text
 * @param {SourceKind} kind
 * @returns {Regions}
 */
export function getRegions(text, kind) {
  switch (kind) {
    case 'css':
      return { lex: null, css: maskCssComments(text), markup: null, astro: null };
    case 'ts':
    case 'tsx':
    case 'js':
      return { lex: lexJs(text), css: null, markup: null, astro: null };
    case 'astro': {
      const astro = splitAstro(text);
      return { lex: lexJs(astroCodeView(text, astro)), css: astroStyleView(text, astro), markup: astro.markup, astro };
    }
    case 'html': {
      const view = text.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => blankText(m));
      const re = /<(script|style)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/\1\s*>/gi;
      const scripts = [];
      const styles = [];
      let m;
      while ((m = re.exec(view)) !== null) {
        const start = m.index + 1 + m[1].length + m[2].length + 1;
        const block = { start, end: start + m[3].length, attrs: m[2] };
        (m[1].toLowerCase() === 'script' ? scripts : styles).push(block);
      }
      const astro = { frontmatter: null, scripts, styles, markup: blankRanges(view, [...scripts, ...styles].map((b) => [b.start, b.end])) };
      return { lex: lexJs(astroCodeView(text, astro)), css: astroStyleView(text, astro), markup: astro.markup, astro };
    }
    default:
      return { lex: null, css: null, markup: null, astro: null };
  }
}

/** True when the word is a plain identifier-like token at `index` of `code` (not part of a longer word). */
export function isWordAt(code, index, word) {
  if (code.slice(index, index + word.length) !== word) return false;
  const before = code[index - 1];
  const after = code[index + word.length];
  return !(before && /[\w$]/.test(before)) && !(after && /[\w$]/.test(after));
}

/**
 * CSS text to scan for a file: the whole file for css, the style blocks and `style` attributes for Astro and html.
 * Each chunk is a view of the same length as the original (or an attribute body with its offset in `base`).
 * @param {string} text
 * @param {SourceKind} kind
 * @returns {Array<{ css: string, base: number }>}
 */
export function cssChunks(text, kind) {
  if (kind === 'css') return [{ css: maskCssComments(text), base: 0 }];
  if (kind !== 'astro' && kind !== 'html') return [];
  const regions = getRegions(text, kind);
  /** @type {Array<{ css: string, base: number }>} */
  const chunks = [];
  if (regions.css !== null) chunks.push({ css: regions.css, base: 0 });
  if (regions.markup !== null) {
    for (const tag of iterTags(regions.markup)) {
      for (const attr of tag.attrs) {
        if (attr.name === 'style' && attr.kind === 'string') chunks.push({ css: attr.value, base: attr.valueStart });
      }
    }
  }
  return chunks;
}

/**
 * Overlays views of the same text: at each position the first view with a non-blank character wins.
 * Used when a scanner wants "everything that is not a comment" across the regions of an Astro file.
 * @param {string[]} views
 */
export function overlayViews(views) {
  if (views.length === 0) return '';
  const out = views[0].split('');
  for (let v = 1; v < views.length; v += 1) {
    const view = views[v];
    for (let i = 0; i < out.length; i += 1) {
      if ((out[i] === ' ' || out[i] === '\t') && view[i] !== ' ' && view[i] !== '\t') out[i] = view[i];
    }
  }
  return out.join('');
}

/**
 * Text with comments removed (blanked), across every region of the file.
 * @param {string} text
 * @param {SourceKind} kind
 */
export function withoutComments(text, kind) {
  const regions = getRegions(text, kind);
  const views = [];
  if (regions.lex !== null) views.push(regions.lex.noComments);
  if (regions.css !== null) views.push(regions.css);
  if (regions.markup !== null) views.push(regions.markup);
  return views.length > 0 ? overlayViews(views) : text;
}
