// Pure scanners for built HTML (dist/). Shared by the baseline capture and `verify-dist`.
// Built-ins only, no HTML parser dependency. The input is Astro's own output, which is well-formed,
// so a small tokenizer is enough. Only `listDistHtml` touches the file system.

import { readdir } from 'node:fs/promises';
import path from 'node:path';

/** @typedef {{ type: 'open', name: string, attrs: Map<string, string>, selfClosing: boolean }} OpenToken */
/** @typedef {{ type: 'close', name: string }} CloseToken */
/** @typedef {{ type: 'text', text: string }} TextToken */
/** @typedef {{ type: 'raw', name: string, text: string }} RawToken */
/** @typedef {OpenToken | CloseToken | TextToken | RawToken} Token */
/** @typedef {{ kind: 'script-src' | 'modulepreload' | 'dynamic-import' | 'static-import', url: string }} ExternalLoad */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is never visible text. `head` covers `<title>`, which is not page copy. */
const HIDDEN_ELEMENTS = new Set(['script', 'style', 'svg', 'noscript', 'template', 'head']);

/** Elements whose content is raw text (not markup). */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

/** Tags that separate words visually. Inline tags join text with nothing, so wrapping words in spans later does not change the text. */
const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'button', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'label', 'legend',
  'li', 'main', 'nav', 'ol', 'option', 'p', 'pre', 'section', 'select', 'summary', 'table', 'tbody', 'td',
  'textarea', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const TAG_RE = /<(\/?)([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/y;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** @param {string} text */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

/**
 * @param {string} source
 * @returns {Map<string, string>} lower-cased attribute name to decoded value ('' for a bare attribute)
 */
function parseAttrs(source) {
  const attrs = new Map();
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(source)) !== null) {
    const name = m[1].toLowerCase();
    if (name === '/') continue;
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

/**
 * Splits HTML into tokens. Comments, doctype and processing instructions are dropped.
 * `<script>` and `<style>` bodies come out as one `raw` token.
 * @param {string} html
 * @returns {Token[]}
 */
export function tokenize(html) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      tokens.push({ type: 'text', text: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: 'text', text: html.slice(i, lt) });

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end < 0 ? html.length : end + 1;
      continue;
    }

    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(html);
    if (m === null) {
      tokens.push({ type: 'text', text: '<' });
      i = lt + 1;
      continue;
    }
    i = lt + m[0].length;
    const name = m[2].toLowerCase();

    if (m[1] === '/') {
      tokens.push({ type: 'close', name });
      continue;
    }

    const selfClosing = /\/\s*$/.test(m[3]) || VOID_ELEMENTS.has(name);
    tokens.push({ type: 'open', name, attrs: parseAttrs(m[3]), selfClosing });

    if (RAW_TEXT_ELEMENTS.has(name) && !selfClosing) {
      const closer = new RegExp(`</${name}[\\s>]`, 'gi');
      closer.lastIndex = i;
      const found = closer.exec(html);
      const end = found === null ? html.length : found.index;
      tokens.push({ type: 'raw', name, text: html.slice(i, end) });
      i = end;
    }
  }
  return tokens;
}

/**
 * Visible text of a page: everything outside `head`, `script`, `style`, `noscript`, `template`, `<svg>` and any
 * element with `aria-hidden="true"`. Entities are decoded and whitespace is collapsed to single spaces.
 * @param {string} html
 * @returns {string}
 */
export function extractVisibleText(html) {
  const parts = [];
  /** @type {string | null} */
  let skipName = null;
  let skipDepth = 0;

  for (const token of tokenize(html)) {
    if (skipName !== null) {
      if (token.type === 'open' && token.name === skipName && !token.selfClosing) skipDepth += 1;
      else if (token.type === 'close' && token.name === skipName) {
        skipDepth -= 1;
        if (skipDepth === 0) skipName = null;
      }
      continue;
    }

    if (token.type === 'text') {
      parts.push(decodeEntities(token.text));
    } else if (token.type === 'open') {
      const hidden = HIDDEN_ELEMENTS.has(token.name) || token.attrs.get('aria-hidden') === 'true';
      if (hidden && !token.selfClosing) {
        skipName = token.name;
        skipDepth = 1;
      } else if (BLOCK_ELEMENTS.has(token.name)) {
        parts.push(' ');
      }
    } else if (token.type === 'close' && BLOCK_ELEMENTS.has(token.name)) {
      parts.push(' ');
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * The set of `href` values on `<a>` elements, sorted and de-duplicated.
 * `<link>` is excluded on purpose: stylesheet and preload URLs carry build hashes.
 * @param {string} html
 * @returns {string[]}
 */
export function extractHrefs(html) {
  const hrefs = new Set();
  for (const token of tokenize(html)) {
    if (token.type === 'open' && token.name === 'a') {
      const href = token.attrs.get('href');
      if (href !== undefined) hrefs.add(href.trim());
    }
  }
  return [...hrefs].sort();
}

/**
 * Route URL for a path relative to `dist/` that ends in `index.html`, or `null` for any other file.
 * @param {string} relativePath e.g. `about/index.html` (either slash style)
 * @returns {string | null}
 */
export function routeFromIndexPath(relativePath) {
  const parts = relativePath.split(/[\\/]+/).filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts[parts.length - 1] !== 'index.html') return null;
  const dirs = parts.slice(0, -1);
  return dirs.length === 0 ? '/' : `/${dirs.join('/')}/`;
}

/**
 * Sorted route list from the file paths found under `dist/` (only `**\/index.html` count).
 * @param {readonly string[]} relativePaths
 * @returns {string[]}
 */
export function listRoutes(relativePaths) {
  const routes = [];
  for (const file of relativePaths) {
    const route = routeFromIndexPath(file);
    if (route !== null) routes.push(route);
  }
  return [...new Set(routes)].sort();
}

/**
 * All `.html` files under `distDir`, as paths relative to it (forward slashes, sorted). The only I/O in this module.
 * @param {string} distDir
 * @returns {Promise<string[]>}
 */
export async function listDistHtml(distDir) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        found.push(path.relative(distDir, full).split(path.sep).join('/'));
      }
    }
  }
  await walk(distDir);
  return found.sort();
}

/**
 * True for any URL that is not local: `http:`, `https:` or protocol-relative `//host`.
 * Relative and root-relative URLs are local.
 * @param {string} url
 */
export function isExternalUrl(url) {
  return /^\s*(?:https?:)?\/\//i.test(url) || /^\s*https?:/i.test(url);
}

const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(["'`])\s*((?:https?:)?\/\/[^"'`]*?)\s*\1/gi;
const STATIC_IMPORT_RE = /\b(?:import|export)\b[^;"'`]*?\bfrom\s*(["'])\s*((?:https?:)?\/\/[^"']*?)\s*\1|\bimport\s*(["'])\s*((?:https?:)?\/\/[^"']*?)\s*\3/gi;

/**
 * Finds every non-local script load in a page: `<script src>`, `<link rel="modulepreload">`, and
 * `import("https://…")` or `import … from "//host/…"` inside inline scripts. Attribute order and quote
 * style do not matter. `<a href>` and other links are ignored.
 * @param {string} html
 * @returns {ExternalLoad[]}
 */
export function scanExternalScripts(html) {
  /** @type {ExternalLoad[]} */
  const loads = [];
  for (const token of tokenize(html)) {
    if (token.type === 'open') {
      if (token.name === 'script') {
        const src = token.attrs.get('src');
        if (src !== undefined && isExternalUrl(src)) loads.push({ kind: 'script-src', url: src.trim() });
      } else if (token.name === 'link') {
        const rel = (token.attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
        const href = token.attrs.get('href');
        if (rel.includes('modulepreload') && href !== undefined && isExternalUrl(href)) {
          loads.push({ kind: 'modulepreload', url: href.trim() });
        }
      }
    } else if (token.type === 'raw' && token.name === 'script') {
      for (const m of token.text.matchAll(DYNAMIC_IMPORT_RE)) loads.push({ kind: 'dynamic-import', url: m[2] });
      for (const m of token.text.matchAll(STATIC_IMPORT_RE)) loads.push({ kind: 'static-import', url: m[2] ?? m[4] });
    }
  }
  return loads;
}
