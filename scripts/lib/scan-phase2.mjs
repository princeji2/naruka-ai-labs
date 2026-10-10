// Phase 2 rules for scripts/verify-source.mjs (task 2.9): the Card rule, the Button rule and the filled-CTA count.
// Pure functions over { file, text } pairs, so the checks can be exercised on fixture strings. No I/O here.
//
//   Card rule     Card.astro has no box-shadow at all and no --card-shadow-* property (tokens.css is not looked at).
//                 "Solid" means opaque: a transparent value and a translucent wash (rgba() with a literal alpha below 1, followed
//                 through var(--token) into tokens.css) are not fills; gradients and unresolvable values are.
//   Button rule   Button.astro gives a solid fill only under `.btn-filled`; no variant is remapped to `filled`
//                 (so `variant="primary"` can never render filled); no other source gives a button or `.btn`-type class a fill.
//   Filled count  `variant="filled"` is used 0 times in src/ before Phase 3 and exactly once, in src/pages/index.astro, from Phase 3.

import { cssChunks, cssDeclarations, createLocator, getRegions, iterTags, splitCssValue, withoutComments } from './scan-util.mjs';

export const CARD_FILE = 'src/components/ui/Card.astro';
export const BUTTON_FILE = 'src/components/Button.astro';
export const FILLED_HOME_FILE = 'src/pages/index.astro';

/** @typedef {{ file: string, text: string }} Source */

const FILL_PROPS = new Set(['background', 'background-color', 'background-image']);
const NO_FILL_VALUE = /^(?:transparent|none|inherit|initial|unset|revert|revert-layer)$/i;

/** Literal alpha of an `rgba()` / `hsla()` / `rgb(... / a)` value, or null when there is none. @param {string} v */
function literalAlpha(v) {
  const m = /^(?:rgba?|hsla?)\(.*(?:,|\/)\s*(\d*\.?\d+)(%?)\s*\)$/i.exec(v);
  if (m === null) return null;
  const a = Number.parseFloat(m[1]);
  return m[2] === '%' ? a / 100 : a;
}

/**
 * True when a `background*` value paints a solid (opaque) fill: anything except transparent / none / CSS-wide keywords
 * and translucent washes (an `rgba()` style value with a literal alpha below 1, followed through `var(--token)` into tokens.css).
 * Gradients and unresolvable values count as fills.
 * @param {string} value
 * @param {Map<string, string>} [tokens] token values from tokens.css
 */
export function isFillValue(value, tokens = new Map()) {
  let v = value.replace(/!important/gi, '').trim();
  for (let guard = 0; guard < 6; guard += 1) {
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
    if (ref === null) break;
    const next = tokens.get(ref[1]);
    if (next === undefined) break;
    v = next.trim();
  }
  if (v === '' || NO_FILL_VALUE.test(v)) return false;
  const alpha = literalAlpha(v);
  return !(alpha !== null && alpha < 1);
}

/** Selector text of the innermost style rule that holds a declaration, or null for at-rules we do not care about. @param {string[]} ancestors */
function ruleSelector(ancestors) {
  if (ancestors.some((a) => /^@(?:-\w+-)?keyframes\b|^@font-face\b/i.test(a))) return null;
  for (let i = ancestors.length - 1; i >= 0; i -= 1) if (!ancestors[i].startsWith('@')) return ancestors[i];
  return null;
}

/**
 * Every fill declaration in a source, with the selector list of its rule and whether the rule is a mask-drawn stroke layer.
 * @param {string} text
 * @param {'astro' | 'css'} kind
 * @param {Map<string, string>} tokens
 * @returns {Array<{ selectors: string[], prop: string, value: string, index: number, strokeLayer: boolean }>}
 */
function fillDeclarations(text, kind, tokens) {
  const out = [];
  for (const chunk of cssChunks(text, kind)) {
    const decls = cssDeclarations(chunk.css, chunk.base);
    for (const d of decls) {
      if (!FILL_PROPS.has(d.prop) || !isFillValue(d.value, tokens)) continue;
      const selector = ruleSelector(d.ancestors);
      if (selector === null) continue;
      const selectors = splitCssValue(selector, ',').map((s) => s.text);
      // A gradient-stroke layer (`.btn-primary::before`) is a ring cut out with mask-composite, not a fill:
      // it counts only when the same rule also declares a mask.
      const sameRule = decls.filter((o) => o.ancestors.join('\u0000') === d.ancestors.join('\u0000'));
      const hasMask = sameRule.some((o) => /^(?:-webkit-)?mask(?:-composite)?$/.test(o.prop));
      const pseudoOnly = selectors.every((s) => /::?(?:before|after)\s*$/.test(s));
      out.push({ selectors, prop: d.prop, value: d.value.trim(), index: d.index, strokeLayer: hasMask && pseudoOnly });
    }
  }
  return out;
}

/** @param {string} text @param {number} index */
const lineOf = (text, index) => createLocator(text)(index).line;

// ---------------------------------------------------------------------------
// Card rule
// ---------------------------------------------------------------------------

/**
 * @param {Source[]} sources
 * @returns {string[]} problems
 */
export function checkCardRule(sources) {
  const card = sources.find((s) => s.file === CARD_FILE);
  if (card === undefined) return [`${CARD_FILE} is missing`];
  const problems = [];
  const code = withoutComments(card.text, 'astro');
  for (const m of code.matchAll(/box-shadow|boxShadow|--card-shadow[\w-]*/g)) {
    problems.push(`${CARD_FILE}:${lineOf(card.text, m.index)}: ${m[0]} (Card has no shadow at rest, hover or focus)`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Button rule
// ---------------------------------------------------------------------------

/**
 * Selectors that name a button or a `.btn`-type class: the element `button`, a `.btn*` / `*-btn*` class, a class containing
 * "button", or a class this file puts on a `<button>` / `<Button>` tag.
 * @param {string} selector
 * @param {Set<string>} buttonClasses
 */
function isButtonSelector(selector, buttonClasses) {
  if (/(?:^|[^\w.#:-])button(?![\w-])/i.test(selector)) return true;
  if (/\[\s*(?:type\s*[~|^$*]?=\s*['"]?(?:submit|button|reset)|role\s*=\s*['"]?button)/i.test(selector)) return true;
  for (const m of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    const cls = m[1];
    if (/(?:^|-)btn(?:$|-)/i.test(cls) || /button/i.test(cls) || buttonClasses.has(cls)) return true;
  }
  return false;
}

/** Classes put on `<button>` / `<Button>` tags (and role="button" elements) in an Astro markup view. @param {string} markup */
function classesOnButtons(markup) {
  const classes = new Set();
  for (const tag of iterTags(markup)) {
    const isButton = tag.name === 'button' || tag.attrs.some((a) => a.name === 'role' && /^['"]?button['"]?$/.test(a.value));
    if (!isButton) continue;
    for (const attr of tag.attrs) {
      if (attr.name !== 'class' && attr.name !== 'class:list') continue;
      const literals = attr.kind === 'expr' ? [...attr.value.matchAll(/(['"`])([^'"`$]*)\1/g)].map((m) => m[2]) : [attr.value];
      for (const lit of literals) for (const c of lit.split(/\s+/)) if (c) classes.add(c);
    }
  }
  return classes;
}

/**
 * @param {Source[]} sources
 * @param {Map<string, string>} [tokens] token values from tokens.css, used to tell a translucent wash from a solid fill
 * @returns {string[]} problems
 */
export function checkButtonRule(sources, tokens = new Map()) {
  const problems = [];
  const button = sources.find((s) => s.file === BUTTON_FILE);
  if (button === undefined) {
    problems.push(`${BUTTON_FILE} is missing`);
  } else {
    // 1. A solid fill exists only under .btn-filled (every selector of the rule).
    const fills = fillDeclarations(button.text, 'astro', tokens);
    let filledRules = 0;
    for (const f of fills) {
      if (f.strokeLayer) continue;
      const bad = f.selectors.filter((s) => !/\.btn-filled\b/.test(s));
      if (bad.length > 0) {
        problems.push(`${BUTTON_FILE}:${lineOf(button.text, f.index)}: ${f.prop}: ${f.value} on ${bad.join(', ')} (a solid fill is allowed only under .btn-filled)`);
      } else if (f.selectors.includes('.btn-filled')) {
        filledRules += 1;
      }
    }
    if (filledRules === 0) problems.push(`${BUTTON_FILE}: the base .btn-filled rule has no solid fill (the filled variant is missing)`);

    // 2. By construction: the class comes straight from the variant prop, the default is primary, and nothing remaps it.
    const regions = getRegions(button.text, 'astro');
    const front = regions.lex?.noComments ?? ''; // strings stay readable, comments are blanked
    const markup = regions.markup ?? '';
    if (!/btn-\$\{variant\}/.test(markup)) {
      problems.push(`${BUTTON_FILE}: the element class is not built from btn-\${variant} (primary could be remapped)`);
    }
    if (!/\bvariant\s*=\s*'primary'/.test(front)) problems.push(`${BUTTON_FILE}: the default variant is not 'primary'`);
    const assignments = [...front.matchAll(/\bvariant\s*=(?![=>])/g)].length;
    if (assignments !== 1) problems.push(`${BUTTON_FILE}: \`variant\` is assigned ${assignments} times (expected only the destructuring default); primary could be remapped to filled`);
  }

  // 3. No other source gives a button or .btn-type class a fill.
  for (const { file, text } of sources) {
    if (file === BUTTON_FILE) continue;
    const kind = file.endsWith('.astro') ? 'astro' : file.endsWith('.css') ? 'css' : null;
    if (kind === null) continue;
    const buttonClasses = kind === 'astro' ? classesOnButtons(getRegions(text, 'astro').markup ?? '') : new Set();
    for (const f of fillDeclarations(text, kind, tokens)) {
      const hit = f.selectors.find((s) => isButtonSelector(s, buttonClasses));
      if (hit !== undefined) problems.push(`${file}:${lineOf(text, f.index)}: ${f.prop}: ${f.value} on ${hit} (only Button.astro's .btn-filled may fill a button)`);
    }
    if (kind === 'astro') {
      const markup = getRegions(text, 'astro').markup ?? '';
      for (const tag of iterTags(markup)) {
        if (tag.name !== 'button') continue;
        const style = tag.attrs.find((a) => a.name === 'style' && a.kind === 'string');
        if (style === undefined) continue;
        for (const d of cssDeclarations(style.value)) {
          if (FILL_PROPS.has(d.prop) && isFillValue(d.value, tokens)) problems.push(`${file}:${lineOf(text, tag.start)}: inline ${d.prop}: ${d.value.trim()} on a button`);
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Filled-CTA usage count (phase aware)
// ---------------------------------------------------------------------------

/**
 * Every `variant="filled"` on a tag in src/ outside Button.astro's own definition.
 * @param {Source[]} sources
 * @returns {Array<{ file: string, line: number }>}
 */
export function findFilledUsages(sources) {
  const uses = [];
  for (const { file, text } of sources) {
    if (file === BUTTON_FILE || !file.endsWith('.astro')) continue;
    const markup = getRegions(text, 'astro').markup ?? '';
    for (const tag of iterTags(markup)) {
      for (const attr of tag.attrs) {
        if (attr.name !== 'variant') continue;
        const filled = attr.kind === 'expr' ? /(['"`])filled\1/.test(attr.value) : attr.value.replace(/^['"]|['"]$/g, '') === 'filled';
        if (filled) uses.push({ file, line: lineOf(text, tag.start) });
      }
    }
  }
  return uses;
}

/**
 * @param {Source[]} sources
 * @param {number} phase
 * @returns {{ problems: string[], uses: Array<{ file: string, line: number }> }}
 */
export function checkFilledCount(sources, phase) {
  const uses = findFilledUsages(sources);
  const problems = [];
  const where = uses.map((u) => `${u.file}:${u.line}`).join(', ');
  if (phase <= 2) {
    if (uses.length > 0) problems.push(`variant="filled" appears ${uses.length} time(s) (${where}); it must appear 0 times before Phase 3`);
  } else {
    if (uses.length !== 1) problems.push(`variant="filled" appears ${uses.length} time(s)${where ? ` (${where})` : ''}; it must appear exactly once from Phase 3`);
    for (const u of uses) {
      if (u.file !== FILLED_HOME_FILE) problems.push(`${u.file}:${u.line}: variant="filled" is allowed only in ${FILLED_HOME_FILE} (the hero CTA)`);
    }
  }
  return { problems, uses };
}
