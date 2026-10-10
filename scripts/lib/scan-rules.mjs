// Source-scan rules for `verify-source` (design: Testing Strategy, L3). Pure functions: text in, hits out.
// No file system, no process, no network. The caller (scripts/verify-source.mjs) walks the files,
// reads them, and passes the text, the repo-relative path, and (where a rule needs one) a lookup
// function or a second file's text.
//
// Per-file rules      console, network, react-location, banned-import, drei-remote, cdn-literal,
//                     font-source, unmanaged-listener
// Cross-file rule     font-size-budget (scanFontSizeBudget)
// Delegated rules     colour-literal (scan-colours), layout-tween and layout-transition (scan-motion),
//                     any-type and ts-directive (scan-types)
// `scanFile` runs every per-file rule that applies to a path.

import { scanColours } from './scan-colours.mjs';
import { collectAnimationNames, scanLayoutTransition, scanLayoutTween } from './scan-motion.mjs';
import { scanTypes } from './scan-types.mjs';
import { readTokenValues } from './contrast.mjs';
import {
  createLocator,
  cssChunks,
  cssDeclarations,
  getRegions,
  iterTags,
  keepRanges,
  kindOfFile,
  lexJs,
  makeHit,
  matchingBracket,
  normalisePath,
  sortHits,
  splitTopLevel,
  withoutComments,
} from './scan-util.mjs';

/** @typedef {import('./scan-util.mjs').Hit} Hit */
/** @typedef {import('./scan-util.mjs').SourceKind} SourceKind */
/** @typedef {Hit & { file: string }} FileHit */
/**
 * @typedef {object} ScanContext
 * @property {(repoRelativePath: string) => boolean} [exists] does a file exist (for font-source)
 * @property {Iterable<string>} [animationNames] `animation` names used anywhere in the project (for layout-transition)
 */

const REMOTE_RE = /^\s*(?:https?:)?\/\/[^\s/]/i;

/** @param {string | undefined} file @param {string[]} prefixes */
function under(file, prefixes) {
  if (file === undefined) return false;
  const f = normalisePath(file);
  return prefixes.some((p) => f.startsWith(p));
}

/**
 * Module specifiers (static import, dynamic import, require, export-from, importScripts) of a lexed file.
 * @param {import('./scan-util.mjs').JsLex} lex
 * @returns {Array<{ specifier: string, index: number }>}
 */
function importSpecifiers(lex) {
  const found = [];
  for (const s of lex.strings) {
    const before = lex.code.slice(Math.max(0, s.start - 40), s.start);
    if (/(?:(?<![\w$.])from|(?<![\w$.])import\s*\(?|(?<![\w$.])require\s*\(|(?<![\w$.])importScripts\s*\()\s*$/.test(before)) {
      found.push({ specifier: s.content, index: s.start + 1 });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// console (R9.2)
// ---------------------------------------------------------------------------

/** Index where the statement or expression that starts at `from` ends. @param {string} code @param {number} from */
function statementEnd(code, from) {
  let i = from;
  while (i < code.length && /\s/.test(code[i])) i += 1;
  let depth = 0;
  for (; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth < 0) return i;
    } else if (ch === ';' && depth === 0) return i;
    else if (ch === '\n' && depth === 0) return i;
  }
  return code.length;
}

/** Ranges of code that only runs when `import.meta.env.DEV` is true. @param {string} code */
function devGuardedRanges(code) {
  /** @type {Array<[number, number]>} */
  const ranges = [];
  for (const m of code.matchAll(/import\s*\.\s*meta\s*\.\s*env\s*\.\s*DEV(?![\w$])/g)) {
    const start = m.index;
    const end = start + m[0].length;
    const lookBack = code.slice(Math.max(0, start - 20), start);
    const ifm = /\bif\s*\(\s*$/.exec(lookBack);
    if (ifm) {
      const open = start - lookBack.length + ifm.index + ifm[0].lastIndexOf('(');
      const close = matchingBracket(code, open);
      if (close === -1) continue;
      const cond = code.slice(open + 1, close).replace(/\s+/g, '');
      if (cond !== 'import.meta.env.DEV' && !cond.startsWith('import.meta.env.DEV&&')) continue;
      let j = close + 1;
      while (j < code.length && /\s/.test(code[j])) j += 1;
      if (code[j] === '{') {
        const bodyEnd = matchingBracket(code, j);
        ranges.push([j, bodyEnd === -1 ? code.length : bodyEnd]);
      } else {
        ranges.push([j, statementEnd(code, j)]);
      }
      continue;
    }
    const after = code.slice(end);
    if (/^\s*&&/.test(after)) {
      ranges.push([end, statementEnd(code, end)]);
    } else if (/^\s*\?/.test(after)) {
      let depth = 0;
      let i = end + after.indexOf('?') + 1;
      const from = i;
      for (; i < code.length; i += 1) {
        const ch = code[i];
        if (ch === '(' || ch === '[' || ch === '{') depth += 1;
        else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
        else if ((ch === ':' || ch === ';') && depth === 0) break;
      }
      ranges.push([from, i]);
    }
  }
  return ranges;
}

/**
 * `console.*` outside an `import.meta.env.DEV` branch.
 * @param {string} text
 * @param {SourceKind} kind
 * @returns {Hit[]}
 */
export function scanConsole(text, kind) {
  const regions = getRegions(text, kind);
  if (regions.lex === null) return [];
  const locate = createLocator(text);
  const { code } = regions.lex;
  const guarded = devGuardedRanges(code);
  /** @type {Hit[]} */
  const hits = [];
  for (const m of code.matchAll(/(?<![\w$.])console\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    if (guarded.some(([a, b]) => m.index >= a && m.index < b)) continue;
    hits.push(makeHit('console', locate, m.index, `console.${m[1]}`));
  }
  return sortHits(hits);
}

// ---------------------------------------------------------------------------
// network (R2.5, R13.6)
// ---------------------------------------------------------------------------

const NETWORK_SCOPE = ['src/lib/', 'src/components/scene/', 'src/pages/signin/'];
const NETWORK_PATTERNS = [
  /(?<![\w$])fetch\s*\(/g,
  /(?<![\w$])XMLHttpRequest(?![\w$])/g,
  /(?<![\w$])sendBeacon(?![\w$])/g,
  /(?<![\w$])WebSocket(?![\w$])/g,
  /(?<![\w$])EventSource(?![\w$])/g,
];
const STORAGE_PATTERN = /(?<![\w$])(?:localStorage|sessionStorage)(?![\w$])/g;

/**
 * Network calls in `src/lib/**`, `src/components/scene/**` and `src/pages/signin/**`; any web storage in the sign-in page.
 * @param {string} text
 * @param {SourceKind} kind
 * @param {string} [file] repo-relative path; a path outside the scope returns no hits, no path scans everything
 * @returns {Hit[]}
 */
export function scanNetwork(text, kind, file) {
  if (file !== undefined && !under(file, NETWORK_SCOPE)) return [];
  const regions = getRegions(text, kind);
  if (regions.lex === null) return [];
  const locate = createLocator(text);
  const { code } = regions.lex;
  /** @type {Hit[]} */
  const hits = [];
  for (const re of NETWORK_PATTERNS) {
    for (const m of code.matchAll(re)) {
      hits.push(makeHit('network', locate, m.index, m[0].replace(/\s*\($/, '')));
    }
  }
  if (under(file, ['src/pages/signin/'])) {
    for (const m of code.matchAll(STORAGE_PATTERN)) hits.push(makeHit('network', locate, m.index, m[0], 'web storage in the sign-in page'));
  }
  return sortHits(hits);
}

// ---------------------------------------------------------------------------
// react-location (R5.4, R5.5)
// ---------------------------------------------------------------------------

const SCENE_DIR = 'src/components/scene/';

/**
 * React belongs to the scene islands only: `.tsx`/`.jsx` files and imports of `react` / `react-dom`
 * are allowed only under `src/components/scene/`.
 * @param {string} text
 * @param {SourceKind} kind
 * @param {string} file repo-relative path
 * @returns {Hit[]}
 */
export function scanReactLocation(text, kind, file) {
  if (under(file, [SCENE_DIR])) return [];
  const locate = createLocator(text);
  /** @type {Hit[]} */
  const hits = [];
  if (/\.(?:tsx|jsx)$/i.test(file)) hits.push(makeHit('react-location', locate, 0, normalisePath(file), 'JSX/TSX outside src/components/scene/'));
  const regions = getRegions(text, kind);
  if (regions.lex !== null) {
    for (const { specifier, index } of importSpecifiers(regions.lex)) {
      if (/^react(?:-dom)?(?:\/|$)/.test(specifier)) hits.push(makeHit('react-location', locate, index, specifier, 'React import outside src/components/scene/'));
    }
  }
  return sortHits(hits);
}

// ---------------------------------------------------------------------------
// banned-import (R5.6, R5.7, R8.2)
// ---------------------------------------------------------------------------

const BANNED_EVERYWHERE = [/^framer-motion(?:\/|$)/, /^tailwindcss(?:\/|$)/, /^@tailwindcss\//, /^@radix-ui\//, /^shadcn/, /^@shadcn\//];
const SCENE_ONLY = [/^three(?:\/|$)/, /^@react-three\//];

/**
 * Banned packages everywhere (`framer-motion`, `tailwindcss`, `@radix-ui/*`, `shadcn*`) and the 3D stack
 * (`three`, `@react-three/*`) outside `src/components/scene/**`. Also flags Tailwind in CSS.
 * @param {string} text
 * @param {SourceKind} kind
 * @param {string} file repo-relative path
 * @returns {Hit[]}
 */
export function scanBannedImport(text, kind, file) {
  const locate = createLocator(text);
  /** @type {Hit[]} */
  const hits = [];
  const inScene = under(file, [SCENE_DIR]);
  const regions = getRegions(text, kind);
  if (regions.lex !== null) {
    for (const { specifier, index } of importSpecifiers(regions.lex)) {
      if (BANNED_EVERYWHERE.some((re) => re.test(specifier))) {
        hits.push(makeHit('banned-import', locate, index, specifier, 'banned package'));
      } else if (!inScene && SCENE_ONLY.some((re) => re.test(specifier))) {
        hits.push(makeHit('banned-import', locate, index, specifier, '3D packages may only be imported under src/components/scene/'));
      }
    }
  }
  if (regions.css !== null) {
    for (const m of regions.css.matchAll(/@import\s+(?:url\(\s*)?['"]?tailwindcss|@tailwind\b/gi)) {
      hits.push(makeHit('banned-import', locate, m.index, m[0], 'Tailwind in CSS'));
    }
  }
  return sortHits(hits);
}

// ---------------------------------------------------------------------------
// drei-remote (R9.9)
// ---------------------------------------------------------------------------

/** @param {string} source @returns {Map<string, string>} drei export name to local name */
function dreiImports(source) {
  const map = new Map();
  for (const m of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@react-three\/drei['"]/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim().replace(/^type\s+/, '');
      if (!p) continue;
      const [name, local] = p.split(/\s+as\s+/);
      map.set(name.trim(), (local ?? name).trim());
    }
  }
  return map;
}

/**
 * drei helpers that fetch from a CDN at run time: `<Environment preset>`, `<Text>` / `<Text3D>` without a local
 * font, and remote URLs passed to `useGLTF`, `useTexture`, `useFont`.
 * @param {string} text
 * @param {SourceKind} kind
 * @returns {Hit[]}
 */
export function scanDreiRemote(text, kind) {
  const regions = getRegions(text, kind);
  if (regions.lex === null) return [];
  const locate = createLocator(text);
  const { code, noComments, strings } = regions.lex;
  /** @type {Hit[]} */
  const hits = [];

  const drei = dreiImports(noComments);
  const jsxView = kind === 'astro' || kind === 'html' ? regions.markup ?? '' : noComments;
  const tagsByName = new Map();
  for (const tag of iterTags(jsxView)) {
    const list = tagsByName.get(tag.name) ?? [];
    list.push(tag);
    tagsByName.set(tag.name, list);
  }
  // iterTags lower-cases tag names; compare in lower case.
  const tagsOf = (exportName) => {
    const local = drei.get(exportName);
    return local === undefined ? [] : tagsByName.get(local.toLowerCase()) ?? [];
  };
  const attr = (tag, name) => tag.attrs.find((a) => a.name === name.toLowerCase());
  const remoteAttr = (a) => a !== undefined && a.kind !== 'none' && (REMOTE_RE.test(a.value) || /['"`]\s*(?:https?:)?\/\//.test(a.value));

  for (const tag of tagsOf('Environment')) {
    if (attr(tag, 'preset') !== undefined) hits.push(makeHit('drei-remote', locate, tag.start, '<Environment preset>', 'preset environments are fetched from a CDN'));
    else if (remoteAttr(attr(tag, 'files'))) hits.push(makeHit('drei-remote', locate, tag.start, '<Environment files>', 'remote environment map'));
  }
  for (const name of ['Text', 'Text3D']) {
    for (const tag of tagsOf(name)) {
      const font = attr(tag, 'font');
      if (font === undefined || font.kind === 'none') {
        hits.push(makeHit('drei-remote', locate, tag.start, `<${name}>`, 'no local font: the default font is fetched from a CDN'));
      } else if (remoteAttr(font)) {
        hits.push(makeHit('drei-remote', locate, tag.start, `<${name} font>`, 'remote font'));
      }
    }
  }
  for (const m of code.matchAll(/(?<![\w$.])(useGLTF|useTexture|useFont)(?:\s*\.\s*preload)?\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(code, open);
    if (close === -1) continue;
    for (const s of strings) {
      if (s.start > open && s.end <= close + 1 && REMOTE_RE.test(s.content)) {
        hits.push(makeHit('drei-remote', locate, s.start + 1, s.content, `${m[1]} with a remote URL`));
      }
    }
  }
  return sortHits(hits);
}

// ---------------------------------------------------------------------------
// cdn-literal (R9.9)
// ---------------------------------------------------------------------------

/**
 * Remote script loads: `<script src>` and `<link rel=modulepreload>` with an absolute or protocol-relative URL,
 * `import('https://...')`, `import x from 'https://...'`, `importScripts('https://...')`.
 * Absolute links in `<a href>` are content and are not flagged.
 * @param {string} text
 * @param {SourceKind} kind
 * @returns {Hit[]}
 */
export function scanCdnLiteral(text, kind) {
  const regions = getRegions(text, kind);
  const locate = createLocator(text);
  /** @type {Hit[]} */
  const hits = [];
  if (regions.lex !== null) {
    for (const { specifier, index } of importSpecifiers(regions.lex)) {
      if (REMOTE_RE.test(specifier)) hits.push(makeHit('cdn-literal', locate, index, specifier, 'remote import'));
    }
  }
  if (regions.markup !== null) {
    for (const tag of iterTags(regions.markup)) {
      const rel = tag.attrs.find((a) => a.name === 'rel');
      const attrName = tag.name === 'script' ? 'src' : tag.name === 'link' && rel !== undefined && /\bmodulepreload\b/i.test(rel.value) ? 'href' : null;
      if (attrName === null) continue;
      const a = tag.attrs.find((x) => x.name === attrName);
      if (a !== undefined && a.kind !== 'none' && REMOTE_RE.test(a.value)) {
        hits.push(makeHit('cdn-literal', locate, a.valueStart, a.value, `<${tag.name} ${attrName}>`));
      }
    }
  }
  return sortHits(hits);
}

// ---------------------------------------------------------------------------
// font-source (R9.9, R16.4)
// ---------------------------------------------------------------------------

const FONT_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|(?:use|kit)\.fontawesome\.com/gi;

/** @param {string} dir @param {string} rel resolves `../x` against a repo-relative directory */
function resolveRelative(dir, rel) {
  const out = dir.split('/').filter(Boolean);
  for (const part of rel.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

/**
 * External font URLs anywhere in `src/` or `public/` (`fonts.googleapis`, `fonts.gstatic`, `@import url(http...)`,
 * a remote `url()` in `@font-face`, a preloaded remote font), and a `url(...)` in `fonts.css` that points to a
 * file that does not exist.
 * @param {string} text
 * @param {SourceKind} kind
 * @param {string} file repo-relative path
 * @param {ScanContext} [ctx] `ctx.exists` enables the missing-file check
 * @returns {Hit[]}
 */
export function scanFontSource(text, kind, file, ctx = {}) {
  if (!under(file, ['src/', 'public/'])) return [];
  const locate = createLocator(text);
  const clean = withoutComments(text, kind);
  /** @type {Hit[]} */
  const hits = [];
  for (const m of clean.matchAll(FONT_HOSTS)) hits.push(makeHit('font-source', locate, m.index, m[0], 'external font host'));
  for (const m of clean.matchAll(/@import\s+(?:url\(\s*)?['"]?(?:https?:)?\/\/[^\s'")]*/gi)) {
    hits.push(makeHit('font-source', locate, m.index, m[0], 'remote @import'));
  }
  for (const { css, base } of cssChunks(text, kind)) {
    for (const d of cssDeclarations(css, base)) {
      if (d.prop !== 'src') continue;
      for (const u of d.value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
        const url = u[2].trim();
        const at = d.valueIndex + u.index;
        if (/^(?:https?:)?\/\//i.test(url)) {
          hits.push(makeHit('font-source', locate, at, url, 'remote url() in a font src'));
        } else if (/(?:^|\/)fonts\.css$/.test(normalisePath(file)) && !/^data:/i.test(url) && ctx.exists) {
          const clean2 = url.replace(/[?#].*$/, '');
          const target = clean2.startsWith('/') ? `public${clean2}` : resolveRelative(normalisePath(file).replace(/\/[^/]*$/, ''), clean2);
          if (!ctx.exists(target)) hits.push(makeHit('font-source', locate, at, url, `file not found: ${target}`));
        }
      }
    }
  }
  const markup = kind === 'astro' || kind === 'html' ? getRegions(text, kind).markup : null;
  if (markup !== null) {
    for (const tag of iterTags(markup)) {
      if (tag.name !== 'link') continue;
      const as = tag.attrs.find((a) => a.name === 'as');
      const href = tag.attrs.find((a) => a.name === 'href');
      if (as && /font/i.test(as.value) && href && REMOTE_RE.test(href.value)) {
        hits.push(makeHit('font-source', locate, href.valueStart, href.value, 'remote font preload'));
      }
    }
  }
  return sortHits(hits);
}

// ---------------------------------------------------------------------------
// font-size-budget (R16.9, R16.10): cross-file
// ---------------------------------------------------------------------------

const GLOBAL_VALUES = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SIZE_VAR_RE = /var\(\s*(--font-size-[\w-]+)\s*(?:,[^)]*)?\)/g;

/**
 * The one named exception to "font-size must be a var(--font-size-*) token".
 * `max(16px, var(--font-size-sm))` is the iOS no-zoom guard: form inputs below 16px make iOS Safari zoom the page
 * on focus. Matched after whitespace normalisation, and only this exact text. Any other literal still fails.
 */
const IOS_NO_ZOOM_GUARD = 'max(16px, var(--font-size-sm))';

/** @param {string} value a trimmed font-size value */
function isIosNoZoomGuard(value) {
  return value.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*,\s*/g, ', ') === IOS_NO_ZOOM_GUARD;
}

/** Resolves a font-size token to text with every var() replaced, or null when it cannot be resolved. */
function resolveSizeText(tokens, name, trail = []) {
  const raw = tokens.get(name);
  if (raw === undefined || trail.includes(name)) return null;
  let failed = false;
  const out = raw.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (whole, inner) => {
    const v = tokens.has(inner) ? resolveSizeText(tokens, inner, [...trail, name]) : null;
    if (v === null) failed = true;
    return v ?? whole;
  });
  return failed ? null : out.replace(/\s+/g, ' ').trim();
}

/** @param {string} s `21px`, `1.5rem` ... in pixels, or null */
function toPx(s) {
  const m = /^(\d+(?:\.\d+)?)(px|rem|em)$/.exec(s.trim());
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16);
}

/** Canonical form of a resolved size, so `17px` and `17px` from two tokens count once. */
function canonicalSize(resolved) {
  const px = toPx(resolved);
  return px === null ? resolved : `${px}px`;
}

/** The smallest size a token can produce: the value itself, or the first argument of clamp(). */
function minSizePx(resolved) {
  const clamp = /^clamp\((.*)\)$/s.exec(resolved);
  if (clamp) {
    const first = splitTopLevel(clamp[1], 0, clamp[1].length)[0];
    return toPx(clamp[1].slice(first.start, first.end));
  }
  return toPx(resolved);
}

/**
 * The font-size budget over the whole tree.
 *   - every `font-size` is `var(--font-size-*)` (global keywords are allowed),
 *   - every referenced token is defined in tokens.css,
 *   - at most 10 distinct Body_Font_Sizes (tokens that resolve to the same value, such as base and md, count once;
 *     each fluid token counts once), each at least 12 px,
 *   - at most 3 display tokens, named `--font-size-display-1..3`, each at least 12 px; display tokens are not part of the 10.
 * @param {Array<{ file: string, text: string }>} files the `.css` and `.astro` files to scan (tokens.css itself is skipped)
 * @param {string} tokensCss text of `src/styles/tokens.css`
 * @param {string} [tokensFile] path reported for project-level findings
 * @returns {FileHit[]}
 */
export function scanFontSizeBudget(files, tokensCss, tokensFile = 'src/styles/tokens.css') {
  const tokens = new Map([...readTokenValues(tokensCss)].filter(([name]) => name.startsWith('--font-size-')));
  const allTokens = readTokenValues(tokensCss);
  /** @type {FileHit[]} */
  const hits = [];
  /** @type {Map<string, { file: string, line: number, column: number, index: number }>} first use of each token */
  const used = new Map();

  for (const { file, text } of files) {
    const path = normalisePath(file);
    const kind = kindOfFile(path);
    if ((kind !== 'css' && kind !== 'astro') || /(^|\/)tokens\.css$/.test(path)) continue;
    const locate = createLocator(text);
    for (const { css, base } of cssChunks(text, kind)) {
      for (const d of cssDeclarations(css, base)) {
        if (d.prop === 'font-size') {
          const value = d.value.trim();
          if (GLOBAL_VALUES.has(value.toLowerCase())) continue;
          const m = /^var\(\s*(--font-size-[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value);
          if (!m && !isIosNoZoomGuard(value)) {
            hits.push({ ...makeHit('font-size-budget', locate, d.valueIndex + d.value.indexOf(value), value, 'font-size must be a var(--font-size-*) token'), file: path });
          }
        }
        if (d.prop === 'font-size' || d.prop === 'font') {
          for (const m of d.value.matchAll(SIZE_VAR_RE)) {
            const at = d.valueIndex + m.index;
            const loc = locate(at);
            if (!used.has(m[1])) used.set(m[1], { file: path, line: loc.line, column: loc.column, index: at });
            if (!tokens.has(m[1])) {
              hits.push({ ...makeHit('font-size-budget', locate, at, m[1], 'token is not defined in tokens.css'), file: path });
            }
          }
        }
      }
    }
  }

  const isDisplay = (name) => name.startsWith('--font-size-display-');
  /** @param {string} name @param {string} detail @param {string} match */
  const projectHit = (name, detail, match) => {
    const u = used.get(name);
    return { rule: 'font-size-budget', file: u ? u.file : tokensFile, line: u ? u.line : 1, column: u ? u.column : 1, index: u ? u.index : 0, match, detail };
  };

  // Body sizes: distinct resolved values among the tokens that are used.
  /** @type {Map<string, string>} canonical value to the first token that has it */
  const bodySizes = new Map();
  for (const name of used.keys()) {
    if (isDisplay(name) || !tokens.has(name)) continue;
    const resolved = resolveSizeText(allTokens, name);
    if (resolved === null) continue;
    const key = canonicalSize(resolved);
    if (!bodySizes.has(key)) bodySizes.set(key, name);
    const min = minSizePx(resolved);
    if (min !== null && min < 12) hits.push(projectHit(name, `Body_Font_Size ${min}px is below 12px`, name));
  }
  if (bodySizes.size > 10) {
    hits.push({
      rule: 'font-size-budget', file: tokensFile, line: 1, column: 1, index: 0, match: String(bodySizes.size),
      detail: `${bodySizes.size} distinct Body_Font_Sizes (limit 10): ${[...bodySizes.values()].join(', ')}`,
    });
  }

  // Display tokens: defined or used.
  const displayNames = new Set([...tokens.keys(), ...used.keys()].filter(isDisplay));
  for (const name of displayNames) {
    if (!/^--font-size-display-[123]$/.test(name)) hits.push(projectHit(name, 'display tokens must be named --font-size-display-1..3', name));
    const resolved = tokens.has(name) ? resolveSizeText(allTokens, name) : null;
    const min = resolved === null ? null : minSizePx(resolved);
    if (min !== null && min < 12) hits.push(projectHit(name, `display size ${min}px is below 12px`, name));
  }
  if (displayNames.size > 3) {
    hits.push({
      rule: 'font-size-budget', file: tokensFile, line: 1, column: 1, index: 0, match: String(displayNames.size),
      detail: `${displayNames.size} display tokens (limit 3): ${[...displayNames].join(', ')}`,
    });
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.index - b.index);
}

// ---------------------------------------------------------------------------
// unmanaged-listener (R6.5, R6.7, R12.9, R12.10)
// ---------------------------------------------------------------------------

/** Events that the gate or the router fire; registering for these once per session is the lifecycle binding itself. */
const LIFECYCLE_EVENT = /^(?:astro:[\w-]+|DOMContentLoaded|pagehide|pageshow)$/;
const GATE_FILE = 'src/lib/lifecycle/page-lifecycle.ts';

/**
 * Body ranges of the functions declared in a lexed code view, by name.
 * @param {string} code
 * @returns {Map<string, [number, number]>}
 */
function functionRanges(code) {
  /** @type {Map<string, [number, number]>} */
  const ranges = new Map();
  const bodyAfterParams = (openParen) => {
    const close = matchingBracket(code, openParen);
    if (close === -1) return null;
    let j = close + 1;
    while (j < code.length && code[j] !== '{' && code[j] !== ';') j += 1;
    if (code[j] !== '{') return null;
    const end = matchingBracket(code, j);
    return end === -1 ? null : /** @type {[number, number]} */ ([j, end]);
  };
  for (const m of code.matchAll(/(?<![\w$.])function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(/g)) {
    const r = bodyAfterParams(m.index + m[0].length - 1);
    if (r) ranges.set(m[1], r);
  }
  const variable =
    /(?<![\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:async\s+)?(function\b[^(]*\(|\((?:[^()]|\([^()]*\))*\)\s*(?::[^=;{]+)?=>|[A-Za-z_$][\w$]*\s*=>)/g;
  for (const m of code.matchAll(variable)) {
    const after = m.index + m[0].length;
    if (m[2].startsWith('function')) {
      const r = bodyAfterParams(after - 1);
      if (r) ranges.set(m[1], r);
      continue;
    }
    let j = after;
    while (j < code.length && /\s/.test(code[j])) j += 1;
    if (code[j] === '{') {
      const end = matchingBracket(code, j);
      if (end !== -1) ranges.set(m[1], [j, end]);
    } else {
      ranges.set(m[1], [j, statementEnd(code, j)]);
    }
  }
  return ranges;
}

/**
 * Ranges of setup functions that are handed to `createGate(...)`, plus the functions they call.
 * @param {string} code
 * @returns {{ ranges: Array<[number, number]>, resolved: boolean }}
 */
function boundSetupRanges(code) {
  const named = functionRanges(code);
  /** @type {Array<[number, number]>} */
  const ranges = [];
  let resolved = false;
  for (const m of code.matchAll(/(?<![\w$.])createGate\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(code, open);
    if (close === -1) continue;
    const arg = code.slice(open + 1, close).trim();
    const ident = /^[A-Za-z_$][\w$]*$/.exec(arg);
    if (ident && named.has(arg)) {
      ranges.push(/** @type {[number, number]} */ (named.get(arg)));
      resolved = true;
    } else if (!ident && arg.length > 0) {
      ranges.push([open + 1, close]);
      resolved = true;
    }
  }
  // Functions called from a bound setup are part of it.
  for (let grow = true; grow;) {
    grow = false;
    for (const [name, range] of named) {
      if (ranges.some(([a, b]) => a === range[0] && b === range[1])) continue;
      const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
      for (const m of code.matchAll(re)) {
        if (ranges.some(([a, b]) => m.index >= a && m.index < b)) {
          ranges.push(range);
          grow = true;
          break;
        }
      }
    }
  }
  return { ranges, resolved };
}

/**
 * Top-level `document.addEventListener` / `window.addEventListener` with no `{ signal }` option that is not inside
 * a setup function bound through `bindPageLifecycle(createGate(setup), ...)`. Applies to the `<script>` blocks of
 * `.astro` files and to `src/lib/**`. The gate's own lifecycle file and listeners for lifecycle events
 * (`astro:*`, `DOMContentLoaded`, `pagehide`, `pageshow`) are exempt.
 * @param {string} text
 * @param {SourceKind} kind
 * @param {string} [file] repo-relative path; with a path, files outside the scope return no hits
 * @returns {Hit[]}
 */
export function scanUnmanagedListener(text, kind, file) {
  const path = file === undefined ? undefined : normalisePath(file);
  if (path !== undefined) {
    if (path === GATE_FILE) return [];
    if (kind !== 'astro' && !path.startsWith('src/lib/')) return [];
  }
  let lex;
  if (kind === 'astro') {
    const parts = getRegions(text, kind).astro;
    if (parts === null || parts.scripts.length === 0) return [];
    lex = lexJs(keepRanges(text, parts.scripts.map((s) => [s.start, s.end])));
  } else {
    const regions = getRegions(text, kind);
    if (regions.lex === null) return [];
    lex = regions.lex;
  }
  const locate = createLocator(text);
  const { code, noComments } = lex;
  const hasBind = /(?<![\w$.])bindPageLifecycle\s*\(/.test(code);
  const bound = hasBind ? boundSetupRanges(code) : { ranges: [], resolved: false };
  /** @type {Hit[]} */
  const hits = [];
  for (const m of code.matchAll(/(?<![\w$.])(document|window|globalThis)\s*\.\s*addEventListener\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(code, open);
    if (close === -1) continue;
    const args = splitTopLevel(code, open + 1, close);
    const typeText = noComments.slice(args[0].start, args[0].end).trim().replace(/^['"`]|['"`]$/g, '');
    if (LIFECYCLE_EVENT.test(typeText)) continue;
    if (args[2] !== undefined && /(?<![\w$])signal(?![\w$])/.test(code.slice(args[2].start, args[2].end))) continue;
    if (hasBind && !bound.resolved) continue; // the file binds its setup, but the setup lives elsewhere
    if (bound.ranges.some(([a, b]) => m.index >= a && m.index < b)) continue;
    hits.push(makeHit('unmanaged-listener', locate, m.index, `${m[1]}.addEventListener(${typeText})`));
  }
  return sortHits(hits);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Runs every per-file rule that applies to a path.
 * `colour-literal` skips `tokens.css`. `font-size-budget` is cross-file: call `scanFontSizeBudget` separately.
 * @param {{ file: string, text: string, ctx?: ScanContext }} input `file` is a repo-relative path
 * @returns {FileHit[]}
 */
export function scanFile({ file, text, ctx = {} }) {
  const path = normalisePath(file);
  const kind = kindOfFile(path);
  if (kind === null) return [];
  /** @type {Hit[]} */
  const hits = [];
  hits.push(...scanColours(text, kind, { file: path }));
  if (kind === 'css' || kind === 'astro') {
    hits.push(...scanLayoutTransition(text, kind, { knownReferences: ctx.animationNames }));
  }
  if (kind === 'ts' || kind === 'tsx' || kind === 'js' || kind === 'astro') {
    hits.push(...scanLayoutTween(text, kind));
    hits.push(...scanConsole(text, kind));
    hits.push(...scanNetwork(text, kind, path));
    hits.push(...scanReactLocation(text, kind, path));
    hits.push(...scanDreiRemote(text, kind));
    hits.push(...scanCdnLiteral(text, kind));
    hits.push(...scanUnmanagedListener(text, kind, path));
  }
  if (kind === 'ts' || kind === 'tsx' || kind === 'astro') hits.push(...scanTypes(text, kind));
  if (kind !== 'html') hits.push(...scanBannedImport(text, kind, path));
  hits.push(...scanFontSource(text, kind, path, ctx));
  return sortHits(hits).map((h) => ({ ...h, file: path }));
}

export { collectAnimationNames };
