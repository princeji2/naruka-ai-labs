// WCAG contrast maths plus a resolver that turns the colour tokens in `tokens.css` into RGB values
// (Requirements 4.6, 9.4). Pure: strings in, numbers out. The caller reads the file.
//
// The resolver understands what tokens.css actually uses: hex, rgb()/rgba() with comma or space
// syntax, var(--x[, fallback]), `rgb(var(--white-rgb))`, `rgba(var(--primary-rgb), 0.25)`,
// color-mix(in srgb, A p%, B p%) (nested), and `transparent`.

/** @typedef {{ r: number, g: number, b: number, a: number }} Rgba  channels 0..255, alpha 0..1 */
/** @typedef {{ fg: string, bg: string, min: number, label?: string }} ContrastPair  fg and bg are token names (`--text`) */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------
// WCAG maths
// ---------------------------------------------------------------------------

/**
 * WCAG relative luminance, 0 (black) to 1 (white).
 * @param {{ r: number, g: number, b: number }} rgb channels 0..255
 */
export function relativeLuminance(rgb) {
  const lin = (c) => {
    const s = clamp(c, 0, 255) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/**
 * WCAG contrast ratio, symmetric, from 1 to 21. Alpha is ignored here; use `compositeOver` first.
 * @param {{ r: number, g: number, b: number } | string} a an RGB object or a colour string
 * @param {{ r: number, g: number, b: number } | string} b
 */
export function contrastRatio(a, b) {
  const ca = typeof a === 'string' ? parseColour(a) : a;
  const cb = typeof b === 'string' ? parseColour(b) : b;
  if (ca === null || cb === null) throw new Error('contrastRatio: unparseable colour');
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Flattens `fg` over an opaque `bg`.
 * @param {Rgba} fg
 * @param {{ r: number, g: number, b: number }} bg
 * @returns {{ r: number, g: number, b: number }}
 */
export function compositeOver(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
}

// ---------------------------------------------------------------------------
// Colour parsing
// ---------------------------------------------------------------------------

/** Splits at top-level occurrences of a character (parentheses respected). */
function splitTop(s, separator) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(s.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(s.slice(from));
  return parts.map((p) => p.trim());
}

/**
 * @param {string} hex `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`
 * @returns {Rgba | null}
 */
export function parseHexColour(hex) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m || ![3, 4, 6, 8].includes(m[1].length)) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

/** @param {string} s a number or a percentage; `scale` maps 100% to this value */
function numberOrPercent(s, scale) {
  const t = s.trim();
  if (t.endsWith('%')) return (parseFloat(t) / 100) * scale;
  return parseFloat(t);
}

/**
 * Parses a literal colour: hex, `rgb()`/`rgba()` (comma or space syntax, optional `/ alpha`), `transparent`.
 * `var()` and `color-mix()` are not literals; use `resolveTokenColour` for those.
 * @param {string} value
 * @returns {Rgba | null}
 */
export function parseColour(value) {
  const v = value.trim();
  if (v.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (v.startsWith('#')) return parseHexColour(v);
  const fn = /^rgba?\(([^)]*)\)$/i.exec(v);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const [r, g, b] = parts.slice(0, 3).map((p) => numberOrPercent(p, 255));
    const a = parts.length === 4 ? numberOrPercent(parts[3], 1) : 1;
    if (![r, g, b, a].every(Number.isFinite)) return null;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Token file
// ---------------------------------------------------------------------------

/**
 * Reads the custom-property declarations of a CSS file. The first declaration of a name wins
 * (the `:root` block comes before the reduced-motion overrides). Comments are ignored.
 * @param {string} css
 * @returns {Map<string, string>}
 */
export function readTokenValues(css) {
  const clean = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');
  const tokens = new Map();
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

/**
 * Replaces `var(--x[, fallback])` with the token's text, recursively.
 * @param {string} expr
 * @param {Map<string, string>} tokens
 * @param {string[]} trail names being resolved, to catch cycles
 */
function substituteVars(expr, tokens, trail) {
  let out = expr;
  for (let guard = 0; guard < 50 && /var\(/.test(out); guard += 1) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_whole, name, fallback) => {
      if (trail.includes(name)) throw new Error(`Token cycle: ${[...trail, name].join(' -> ')}`);
      const value = tokens.get(name);
      if (value === undefined) {
        if (fallback !== undefined) return fallback;
        throw new Error(`Token ${name} is not defined`);
      }
      return value;
    });
  }
  return out;
}

/**
 * Evaluates a colour expression whose `var()` calls are already substituted.
 * @param {string} expr
 * @returns {Rgba}
 */
function evaluate(expr) {
  const e = expr.trim();
  const literal = parseColour(e);
  if (literal) return literal;
  const mix = /^color-mix\((.*)\)$/is.exec(e);
  if (mix) {
    const args = splitTop(mix[1], ',');
    if (!/^in\s+srgb$/i.test(args[0]) || args.length !== 3) throw new Error(`Unsupported colour-mix: ${e}`);
    const side = (arg) => {
      const pm = /^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/s.exec(arg.trim());
      return { colour: evaluate(pm[1]), pct: pm[2] === undefined ? null : parseFloat(pm[2]) };
    };
    const first = side(args[1]);
    const second = side(args[2]);
    let p1 = first.pct;
    let p2 = second.pct;
    if (p1 === null && p2 === null) p1 = p2 = 50;
    else if (p1 === null) p1 = 100 - p2;
    else if (p2 === null) p2 = 100 - p1;
    const total = p1 + p2;
    const w1 = p1 / total;
    const w2 = p2 / total;
    const a = first.colour.a * w1 + second.colour.a * w2;
    const channel = (c) => (a === 0 ? 0 : (first.colour[c] * first.colour.a * w1 + second.colour[c] * second.colour.a * w2) / a);
    return { r: channel('r'), g: channel('g'), b: channel('b'), a: a * (Math.min(total, 100) / 100) };
  }
  throw new Error(`Unsupported colour expression: ${e}`);
}

/**
 * Resolves a token name (`--text`) or a colour expression to RGBA.
 * @param {string | Map<string, string>} cssOrTokens tokens.css text, or the Map from `readTokenValues`
 * @param {string} nameOrExpr
 * @returns {Rgba}
 */
export function resolveTokenColour(cssOrTokens, nameOrExpr) {
  const tokens = typeof cssOrTokens === 'string' ? readTokenValues(cssOrTokens) : cssOrTokens;
  const trimmed = nameOrExpr.trim();
  const isName = /^--[\w-]+$/.test(trimmed);
  if (isName && !tokens.has(trimmed)) throw new Error(`Token ${trimmed} is not defined`);
  const raw = isName ? /** @type {string} */ (tokens.get(trimmed)) : trimmed;
  return evaluate(substituteVars(raw, tokens, isName ? [trimmed] : []));
}

/**
 * Contrast of two colour tokens. A translucent foreground is flattened over the (opaque) background.
 * @param {string | Map<string, string>} cssOrTokens
 * @param {string} fgToken
 * @param {string} bgToken
 */
export function contrastForTokens(cssOrTokens, fgToken, bgToken) {
  const tokens = typeof cssOrTokens === 'string' ? readTokenValues(cssOrTokens) : cssOrTokens;
  const bg = resolveTokenColour(tokens, bgToken);
  const fg = resolveTokenColour(tokens, fgToken);
  const bgOpaque = bg.a < 1 ? compositeOver(bg, { r: 0, g: 0, b: 0 }) : bg;
  return contrastRatio(fg.a < 1 ? compositeOver(fg, bgOpaque) : fg, bgOpaque);
}

/**
 * Checks declared pairs against `tokens.css`. A pair that cannot be resolved is reported with `error`, never skipped.
 * @param {string} css
 * @param {ContrastPair[]} pairs
 * @returns {Array<{ fg: string, bg: string, min: number, label: string, ratio: number | null, ok: boolean, error?: string }>}
 */
export function checkContrastPairs(css, pairs) {
  const tokens = readTokenValues(css);
  return pairs.map((pair) => {
    const label = pair.label ?? `${pair.fg} on ${pair.bg}`;
    try {
      const ratio = contrastForTokens(tokens, pair.fg, pair.bg);
      return { fg: pair.fg, bg: pair.bg, min: pair.min, label, ratio, ok: ratio >= pair.min };
    } catch (cause) {
      return { fg: pair.fg, bg: pair.bg, min: pair.min, label, ratio: null, ok: false, error: String(cause instanceof Error ? cause.message : cause) };
    }
  });
}
