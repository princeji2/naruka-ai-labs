// Colour-literal scanner (rule `colour-literal`, Requirements 4.1, 4.2, 15.6).
// Pure: text in, hits out. Colours must come from the design tokens, so this flags
//   - hex colours (#rgb, #rgba, #rrggbb, #rrggbbaa),
//   - rgb( rgba( hsl( hsla( whose first argument is a number or percentage (comma or space syntax),
//   - named colours in colour-bearing positions.
// It does not flag transparent, currentColor, inherit, rgba(var(--x-rgb), a), hex inside
// href / id / for / url(#...) / selectors, anything in a comment, or anything in tokens.css.

import {
  blankCssNoise,
  cssDeclarations,
  createLocator,
  getRegions,
  iterTags,
  lexJs,
  makeHit,
  sortHits,
} from './scan-util.mjs';

/** @typedef {import('./scan-util.mjs').Hit} Hit */
/** @typedef {import('./scan-util.mjs').SourceKind} SourceKind */

const RULE = 'colour-literal';

/** CSS named colours. `transparent` and `currentcolor` are deliberately not here. */
export const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
    'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
    'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
    'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
    'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
    'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen'
  ).split(' '),
);

/** Presentation attributes (SVG and legacy HTML) whose value is a colour. */
const COLOUR_ATTRS = new Set([
  'fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color', 'bgcolor', 'background',
]);

const HEX_RE = /(?<![\w#&/.-])#([0-9a-fA-F]{3,8})(?![\w-])/g;
const FUNC_RE = /(?<![\w-])(rgba?|hsla?)\(\s*[+-]?(?:\d|\.\d)/gi;
const IDENT_RE = /(?<![\w-])[A-Za-z][A-Za-z-]*(?![\w-])/g;

/** Is `prop` a CSS property whose value can carry a colour? Custom properties count. @param {string} prop */
function isColourProp(prop) {
  if (prop.startsWith('--')) return true;
  return (
    prop.startsWith('border') ||
    prop.startsWith('outline') ||
    prop.startsWith('background') ||
    prop.endsWith('color') ||
    prop.endsWith('shadow') ||
    prop === 'fill' ||
    prop === 'stroke' ||
    prop === 'filter' ||
    prop === 'backdrop-filter' ||
    prop.startsWith('text-decoration') ||
    prop.startsWith('column-rule') ||
    prop === '-webkit-text-stroke'
  );
}

/**
 * Finds colour literals in a CSS-like value.
 * @param {string} value value text with strings and url() bodies already blanked
 * @param {boolean} names also look for named colours
 * @returns {Array<{ offset: number, match: string, detail: string }>}
 */
function colourLiteralsInValue(value, names) {
  const found = [];
  for (const m of value.matchAll(HEX_RE)) {
    if ([3, 4, 6, 8].includes(m[1].length)) found.push({ offset: m.index, match: m[0], detail: 'hex' });
  }
  for (const m of value.matchAll(FUNC_RE)) {
    found.push({ offset: m.index, match: `${m[1].toLowerCase()}(`, detail: 'function' });
  }
  if (names) {
    for (const m of value.matchAll(IDENT_RE)) {
      if (!NAMED_COLOURS.has(m[0].toLowerCase())) continue;
      const after = value.slice(m.index + m[0].length).trimStart()[0];
      if (after === '(') continue; // a function such as tan(45deg), not a colour
      found.push({ offset: m.index, match: m[0], detail: 'named' });
    }
  }
  return found;
}

/**
 * @param {string} cssText comment-masked CSS (or a style attribute body)
 * @param {number} base offset of `cssText` in the original text
 * @param {(i: number) => { line: number, column: number }} locate
 * @param {Hit[]} hits
 * @param {boolean} [allNamed] treat every declaration as colour-bearing (style attributes of colour attributes)
 */
function scanCss(cssText, base, locate, hits, allNamed = false) {
  for (const decl of cssDeclarations(cssText, base)) {
    const value = blankCssNoise(decl.value);
    for (const f of colourLiteralsInValue(value, allNamed || isColourProp(decl.prop))) {
      hits.push(makeHit(RULE, locate, decl.valueIndex + f.offset, f.match, f.detail));
    }
  }
}

const SELECTOR_CONTEXT = [
  /(?:querySelector(?:All)?|closest|matches|getElementById|scrollIntoView|getElementsByClassName)\s*\(\s*$/,
  /\b(?:href|id|htmlFor|hash|for)\s*[:=]\s*$/,
  /setAttribute\(\s*['"](?:href|id|for|aria-[\w-]+|data-[\w-]+)['"]\s*,\s*$/,
  /(?:selector|target|trigger|anchor|hash)\w*\s*[:=]\s*$/i,
];

/**
 * True when a string literal starting at `strStart` is used as a selector, fragment or id,
 * where `#abc` is not a colour.
 * @param {string} text
 * @param {number} strStart
 */
function inSelectorContext(text, strStart) {
  const before = text.slice(Math.max(0, strStart - 80), strStart);
  return SELECTOR_CONTEXT.some((re) => re.test(before));
}

/**
 * @param {import('./scan-util.mjs').JsLex} lex
 * @param {string} text original text
 * @param {(i: number) => { line: number, column: number }} locate
 * @param {Hit[]} hits
 * @param {number} [offset] position of the lexed text inside `text` (for expressions taken from a template)
 */
function scanJsStrings(lex, text, locate, hits, offset = 0) {
  for (const s of lex.strings) {
    const content = s.content;
    if (!content.trim()) continue;
    const base = offset + s.start + 1;
    const noise = blankCssNoise(content);
    const selector = inSelectorContext(text, offset + s.start);
    for (const f of colourLiteralsInValue(noise, false)) {
      if (f.detail === 'hex' && selector) continue;
      hits.push(makeHit(RULE, locate, base + f.offset, f.match, f.detail));
    }
    const trimmed = content.trim();
    if (NAMED_COLOURS.has(trimmed.toLowerCase())) {
      hits.push(makeHit(RULE, locate, base + content.indexOf(trimmed), trimmed, 'named'));
    } else if (/^[\s\w-]+:/.test(content) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      // CSS text assigned from JS, for example 'color: red; padding: 0'
      for (const decl of cssDeclarations(noise, base)) {
        if (!isColourProp(decl.prop)) continue;
        for (const f of colourLiteralsInValue(blankCssNoise(decl.value), true)) {
          if (f.detail === 'named') hits.push(makeHit(RULE, locate, decl.valueIndex + f.offset, f.match, f.detail));
        }
      }
    }
  }
}

/**
 * @param {string} markup
 * @param {string} text original text
 * @param {(i: number) => { line: number, column: number }} locate
 * @param {Hit[]} hits
 */
function scanTags(markup, text, locate, hits) {
  for (const tag of iterTags(markup)) {
    const nameAttr = tag.attrs.find((a) => a.name === 'name');
    const isColourMeta = tag.name === 'meta' && nameAttr !== undefined && /colou?r/i.test(nameAttr.value);
    for (const attr of tag.attrs) {
      if (attr.kind === 'none') continue;
      const isColourAttr = attr.name === 'style' || COLOUR_ATTRS.has(attr.name) || (attr.name === 'content' && isColourMeta);
      if (!isColourAttr) continue;
      if (attr.kind === 'expr') {
        // fill={'#fff'} or style={{ color: 'red' }}: the strings are scanned like any JS string
        scanJsStrings(lexJs(attr.value), text, locate, hits, attr.valueStart);
        continue;
      }
      if (attr.name === 'style') {
        scanCss(attr.value, attr.valueStart, locate, hits);
        continue;
      }
      for (const f of colourLiteralsInValue(blankCssNoise(attr.value), true)) {
        hits.push(makeHit(RULE, locate, attr.valueStart + f.offset, f.match, f.detail));
      }
    }
  }
}

/**
 * Normalised path test for the token file.
 * @param {string | undefined} file
 */
export function isTokenFile(file) {
  return file !== undefined && /(^|\/)tokens\.css$/.test(file.replace(/\\/g, '/'));
}

/**
 * Finds colour literals.
 * @param {string} text file content
 * @param {SourceKind} kind 'css' | 'astro' | 'ts' | 'tsx' | 'js' | 'html'
 * @param {{ file?: string }} [options] pass the path so `tokens.css` is ignored
 * @returns {Hit[]} hits sorted by position
 */
export function scanColours(text, kind, options = {}) {
  if (isTokenFile(options.file)) return [];
  const locate = createLocator(text);
  const regions = getRegions(text, kind);
  /** @type {Hit[]} */
  const hits = [];
  if (regions.css !== null) scanCss(regions.css, 0, locate, hits);
  if (regions.lex !== null) {
    // For JS the hit position must index into `text`, which the lexer views mirror one to one.
    scanJsStrings(regions.lex, text, locate, hits);
  }
  if (regions.markup !== null) scanTags(regions.markup, text, locate, hits);
  return sortHits(hits);
}
