// Layout-animation scanners (rules `layout-tween` and `layout-transition`, Requirements 6.8, 6.9, 13.5).
// Only composited properties (transform, opacity, and a few paint-only ones) may be animated.
// Pure: text in, hits out.
//
//   scanLayoutTween      GSAP to / from / fromTo / set / quickTo (and timeline calls) with a layout key.
//   scanLayoutTransition CSS and Astro <style>: `transition` / `transition-property` naming a layout property
//                        or `all`, a `transition` shorthand with no property (means `all`), and @keyframes
//                        that set layout properties and are referenced by `animation`.

import {
  createLocator,
  cssChunks,
  cssDeclarations,
  getRegions,
  makeHit,
  matchingBracket,
  sortHits,
  splitCssValue,
  splitTopLevel,
} from './scan-util.mjs';

/** @typedef {import('./scan-util.mjs').Hit} Hit */
/** @typedef {import('./scan-util.mjs').SourceKind} SourceKind */

const LAYOUT_RE =
  /^(?:width|height|min-width|min-height|max-width|max-height|top|left|right|bottom|inset(?:-[\w-]+)?|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?)$/;

/**
 * Is this a layout property or GSAP key (`width`, `marginLeft`, `margin-left`, `inset`, `paddingTop` ...)?
 * Right, bottom, inset, margin* and padding* are a deliberate superset of width, height, top, left.
 * @param {string} name
 */
export function isLayoutProperty(name) {
  const kebab = name
    .trim()
    .replace(/^['"`]|['"`]$/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
  return LAYOUT_RE.test(kebab);
}

// ---------------------------------------------------------------------------
// GSAP tweens
// ---------------------------------------------------------------------------

const NOT_GSAP_RECEIVERS = new Set([
  'Array', 'Object', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Reflect', 'Symbol', 'JSON', 'Math', 'Number',
  'String', 'Date', 'URL', 'URLSearchParams', 'Intl', 'BigInt', 'Buffer', 'Uint8Array', 'Uint16Array', 'Uint32Array',
  'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array',
]);

const CALL_RE = /\.\s*(to|from|fromTo|set|quickTo)\s*\(/g;

/**
 * Layout keys of an object literal, at any depth (nested `css`, `keyframes`, `scrollTrigger` objects included).
 * Function values are not entered. Strings and comments never count, only property keys.
 * @param {string} code lexed code view (strings blanked)
 * @param {string} source lexed view with strings readable
 * @param {number} start index of the `{`
 * @param {number} end index of the matching `}`
 * @param {Array<{ key: string, index: number }>} out
 */
function collectLayoutKeys(code, source, start, end, out) {
  for (const entry of splitTopLevel(code, start + 1, end)) {
    const slice = code.slice(entry.start, entry.end);
    if (!slice.trim()) continue;
    let depth = 0;
    let colon = -1;
    for (let i = entry.start; i < entry.end; i += 1) {
      const ch = code[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      else if (ch === ':' && depth === 0) {
        colon = i;
        break;
      }
    }
    const keyEnd = colon === -1 ? entry.end : colon;
    const keyRaw = source.slice(entry.start, keyEnd);
    const key = keyRaw.trim();
    const keyIndex = entry.start + (keyRaw.length - keyRaw.trimStart().length);
    const plain = key.replace(/^['"]|['"]$/g, '');
    if (/^[A-Za-z_$][\w$-]*$/.test(plain) && !key.startsWith('...') && isLayoutProperty(plain)) {
      out.push({ key: plain, index: keyIndex });
    }
    if (colon === -1) continue;
    // Recurse into object and array values.
    let v = colon + 1;
    while (v < entry.end && /\s/.test(code[v])) v += 1;
    if (code[v] === '{') {
      const close = matchingBracket(code, v);
      if (close !== -1 && close <= entry.end) collectLayoutKeys(code, source, v, close, out);
    } else if (code[v] === '[') {
      const close = matchingBracket(code, v);
      if (close === -1) continue;
      for (const el of splitTopLevel(code, v + 1, close)) {
        let e = el.start;
        while (e < el.end && /\s/.test(code[e])) e += 1;
        if (code[e] === '{') {
          const elClose = matchingBracket(code, e);
          if (elClose !== -1 && elClose <= el.end) collectLayoutKeys(code, source, e, elClose, out);
        }
      }
    }
  }
}

/**
 * Finds GSAP calls (`gsap.to`, `tl.fromTo`, `gsap.timeline().set`, `gsap.quickTo`) that animate a layout property.
 * One hit per call, positioned at the first offending key.
 * @param {string} text
 * @param {SourceKind} kind 'ts' | 'tsx' | 'js' | 'astro' (frontmatter and scripts)
 * @returns {Hit[]}
 */
export function scanLayoutTween(text, kind) {
  const regions = getRegions(text, kind);
  if (regions.lex === null) return [];
  const locate = createLocator(text);
  const { code, noComments } = regions.lex;
  /** @type {Hit[]} */
  const hits = [];
  for (const m of code.matchAll(CALL_RE)) {
    const fn = m[1];
    const dot = m.index;
    // Receiver: the identifier before the dot, or a closing parenthesis (gsap.timeline().to).
    let r = dot - 1;
    while (r >= 0 && /\s/.test(code[r])) r -= 1;
    if (code[r] !== ')') {
      let s = r;
      while (s >= 0 && /[\w$]/.test(code[s])) s -= 1;
      const receiver = code.slice(s + 1, r + 1);
      if (!receiver || NOT_GSAP_RECEIVERS.has(receiver)) continue;
    }
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(code, open);
    if (close === -1) continue;
    /** @type {Array<{ key: string, index: number }>} */
    const found = [];
    const args = splitTopLevel(code, open + 1, close);
    args.forEach((arg, position) => {
      let a = arg.start;
      while (a < arg.end && /\s/.test(code[a])) a += 1;
      if (code[a] === '{') {
        const argClose = matchingBracket(code, a);
        if (argClose !== -1 && argClose < arg.end) collectLayoutKeys(code, noComments, a, argClose, found);
      } else if (fn === 'quickTo' && position === 1) {
        const literal = noComments.slice(arg.start, arg.end).trim();
        const plain = literal.replace(/^['"`]|['"`]$/g, '');
        if (/^['"`].*['"`]$/.test(literal) && isLayoutProperty(plain)) {
          found.push({ key: plain, index: arg.start + noComments.slice(arg.start, arg.end).indexOf(literal) });
        }
      }
    });
    if (found.length > 0) {
      found.sort((x, y) => x.index - y.index);
      hits.push(makeHit('layout-tween', locate, found[0].index, found[0].key, `gsap ${fn}(): ${found.map((f) => f.key).join(', ')}`));
    }
  }
  return sortHits(hits);
}

// ---------------------------------------------------------------------------
// CSS transitions and keyframes
// ---------------------------------------------------------------------------

const EASING = new Set(['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end']);
const NON_PROPERTY_WORDS = new Set(['allow-discrete', 'normal']);
const GLOBAL_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none']);

/** @param {string} token */
function isTimeToken(token) {
  return /^[+-]?(?:\d*\.)?\d+m?s$/i.test(token);
}

/**
 * What does one comma-separated `transition` item animate?
 * @param {string} item
 * @returns {{ problem: 'all' | 'layout' | 'no-property' | null, property?: string }}
 */
function classifyTransitionItem(item) {
  const tokens = splitCssValue(item, ' ').map((t) => t.text);
  if (tokens.length === 0) return { problem: null };
  if (tokens.length === 1 && GLOBAL_KEYWORDS.has(tokens[0].toLowerCase())) return { problem: null };
  const property = tokens.find((t) => {
    const lower = t.toLowerCase();
    if (isTimeToken(lower) || EASING.has(lower) || NON_PROPERTY_WORDS.has(lower)) return false;
    if (/^(?:var|calc|min|max|clamp|cubic-bezier|steps|linear)\(/i.test(lower)) return false;
    return /^-?[a-z_][\w-]*$/i.test(t);
  });
  if (property === undefined) return { problem: 'no-property' };
  if (property.toLowerCase() === 'none') return { problem: null };
  if (property.toLowerCase() === 'all') return { problem: 'all', property };
  if (isLayoutProperty(property)) return { problem: 'layout', property };
  return { problem: null, property };
}

/** @param {string[]} ancestors */
function keyframesName(ancestors) {
  for (const prelude of ancestors) {
    const m = /^@(?:-webkit-|-moz-)?keyframes\s+(?:"([^"]+)"|'([^']+)'|([\w-]+))/i.exec(prelude);
    if (m) return m[1] ?? m[2] ?? m[3];
  }
  return null;
}

/**
 * Names used by `animation` / `animation-name` declarations. Lets a caller that scans a stylesheet
 * and its consumers separately (keyframes in `global.css`, `animation` in a component) pass the
 * names found elsewhere to `scanLayoutTransition` through `knownReferences`.
 * @param {string} text
 * @param {SourceKind} kind
 * @returns {Set<string>}
 */
export function collectAnimationNames(text, kind) {
  const names = new Set();
  for (const { css, base } of cssChunks(text, kind)) {
    for (const d of cssDeclarations(css, base)) {
      if (d.prop !== 'animation' && d.prop !== 'animation-name') continue;
      for (const part of splitCssValue(d.value, ',')) {
        for (const token of splitCssValue(part.text, ' ')) names.add(token.text.replace(/^['"]|['"]$/g, ''));
      }
    }
  }
  return names;
}

/**
 * Finds CSS transitions and keyframe animations of layout properties.
 * One hit per offending declaration. A `@keyframes` is only reported when an `animation` or
 * `animation-name` in the same file (or in `options.knownReferences`) uses its name.
 * @param {string} text
 * @param {SourceKind} kind 'css' | 'astro'
 * @param {{ knownReferences?: Iterable<string> }} [options]
 * @returns {Hit[]}
 */
export function scanLayoutTransition(text, kind, options = {}) {
  const locate = createLocator(text);
  const chunks = cssChunks(text, kind);
  /** @type {Hit[]} */
  const hits = [];
  const referenced = new Set(options.knownReferences ?? []);
  for (const name of collectAnimationNames(text, kind)) referenced.add(name);
  /** @type {Map<string, Array<{ prop: string, index: number }>>} */
  const keyframeLayout = new Map();

  for (const { css, base } of chunks) {
    for (const d of cssDeclarations(css, base)) {
      const fname = keyframesName(d.ancestors);
      if (fname !== null) {
        if (isLayoutProperty(d.prop)) {
          const list = keyframeLayout.get(fname) ?? [];
          list.push({ prop: d.prop, index: d.index });
          keyframeLayout.set(fname, list);
        }
        continue;
      }
      if (d.prop === 'transition-property') {
        for (const item of splitCssValue(d.value, ',')) {
          const lower = item.text.toLowerCase();
          if (lower === 'all' || isLayoutProperty(item.text)) {
            hits.push(makeHit('layout-transition', locate, d.valueIndex + item.offset, item.text, `transition-property: ${item.text}`));
          }
        }
      } else if (d.prop === 'transition') {
        for (const item of splitCssValue(d.value, ',')) {
          const c = classifyTransitionItem(item.text);
          if (c.problem === null) continue;
          const what = c.problem === 'no-property' ? 'shorthand with no property (means all)' : c.property;
          hits.push(makeHit('layout-transition', locate, d.valueIndex + item.offset, item.text, `transition: ${what}`));
        }
      }
    }
  }
  for (const [name, list] of keyframeLayout) {
    if (!referenced.has(name)) continue;
    for (const entry of list) {
      hits.push(makeHit('layout-transition', locate, entry.index, entry.prop, `@keyframes ${name} animates ${entry.prop}`));
    }
  }
  return sortHits(hits);
}
