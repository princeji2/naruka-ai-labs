// verify-dist: checks the built site in dist/ against the baseline and the upgrade rules.
// Run after `npm run build`. Built-ins only. The HTML scanners live in scripts/lib/scan-dist.mjs.
//
//   node scripts/verify-dist.mjs [--dist=<dir>] [--baseline=<file>] [--phase=<1..5>] [--router=absent|present]
//
// --phase (default 3) switches the Scene_3D checks:
//   - phase 3 and later (the default): the scene checks are mandatory. The home route `/` must contain a `.scene`,
//     the `three` positive control must hold (a chunk with the markers exists and is reachable only through dynamic
//     `import()`), and the scene a11y and aspect-ratio checks are never vacuous.
//   - phase 1 and 2: the scene checks pass vacuously while no `.scene` exists, and the report says so.
//
// --router (default `present` since task 3.18) is independent of --phase:
//   - `present` (the default): every built page carries the ClientRouter marker
//     (`<meta name="astro-view-transitions-enabled" content="true">`), and `/signin/` keeps its noindex.
//   - `absent`: no built page carries the marker (the Phase 1 and 2 mode; pass --router=absent to re-run it).
//
// Exit code 0 when every check passes, 1 otherwise (or when dist/ or the baseline is missing).

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  extractHrefs,
  extractVisibleText,
  isExternalUrl,
  listDistHtml,
  listRoutes,
  routeFromIndexPath,
  scanExternalScripts,
  tokenize,
} from './lib/scan-dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} name @returns {string | undefined} */
function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}

const DIST = path.resolve(ROOT, arg('dist') ?? 'dist');
const BASELINE = path.resolve(ROOT, arg('baseline') ?? 'scripts/baseline/routes-and-text.json');
const PHASE_DEFAULT = 3;
const PHASE = Number.parseInt(arg('phase') ?? String(PHASE_DEFAULT), 10);
if (!Number.isInteger(PHASE) || PHASE < 1 || PHASE > 5) fatal(`--phase must be an integer 1..5, got "${arg('phase')}"`);
/** Flipped to 'present' by task 3.18 (ClientRouter now lives in BaseLayout.astro). Deliberately NOT derived from --phase; pass --router=absent to re-run the old mode. */
const ROUTER_DEFAULT = 'present';
const ROUTER_MODE = arg('router') ?? ROUTER_DEFAULT;
if (ROUTER_MODE !== 'absent' && ROUTER_MODE !== 'present') fatal(`--router must be "absent" or "present", got "${ROUTER_MODE}"`);
const ROUTER_EXPECTED = ROUTER_MODE === 'present';
const SCENES_MANDATORY = PHASE >= 3;

const THREE_MARKERS = ['WebGLRenderer', '__THREE__'];
const ROUTER_META_NAME = 'astro-view-transitions-enabled';

/** @type {{ name: string, ok: boolean, vacuous: boolean, details: string[] }[]} */
const results = [];

/**
 * @param {string} name
 * @param {string[]} problems empty means pass
 * @param {{ vacuous?: boolean, note?: string }} [opts]
 */
function record(name, problems, opts = {}) {
  const ok = problems.length === 0;
  const details = ok ? (opts.note ? [opts.note] : []) : problems;
  results.push({ name, ok, vacuous: ok && opts.vacuous === true, details });
}

/** @param {string} message */
function fatal(message) {
  console.error(`verify-dist: ${message}`);
  process.exit(1);
}

/** @param {string} p */
async function exists(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} dir
 * @param {(name: string) => boolean} keep
 * @returns {Promise<string[]>} absolute paths, sorted
 */
async function walkFiles(dir, keep) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && keep(entry.name)) out.push(full);
    }
  }
  await walk(dir);
  return out.sort();
}

/** Strips query and hash. @param {string} url */
function cleanUrl(url) {
  return url.trim().replace(/[?#].*$/, '');
}

/** True for `/x` and false for `//host`, `http:`, relative and empty. @param {string} url */
function isRootRelative(url) {
  return url.startsWith('/') && !url.startsWith('//');
}

/**
 * Resolves a local URL found in a file to an absolute path inside dist, or null when external or not a path.
 * @param {string} spec
 * @param {string} fromDir absolute directory used for relative specs
 */
function resolveLocal(spec, fromDir) {
  const url = cleanUrl(spec);
  if (url === '' || isExternalUrl(url) || /^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  const abs = url.startsWith('/') ? path.join(DIST, url) : path.resolve(fromDir, url);
  const rel = path.relative(DIST, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : abs;
}

/** @param {string} s @param {number} [n] */
function excerpt(s, n = 90) {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}

/** First position where two strings differ, with context. @param {string} a @param {string} b */
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const from = Math.max(0, i - 30);
  return `at char ${i}: expected "${a.slice(from, i + 40)}" but built has "${b.slice(from, i + 40)}"`;
}

/** @param {readonly string[]} a @param {readonly string[]} b */
function setDiff(a, b) {
  const sb = new Set(b);
  return a.filter((x) => !sb.has(x));
}

// ---------------------------------------------------------------------------------------------------------------------
// JS graph helpers (static and dynamic import edges, scripts and CSS)
// ---------------------------------------------------------------------------------------------------------------------

const STATIC_FROM_RE = /\b(?:import|export)\s*(?:[\w$*{},\s]*?)\s*from\s*(["'])([^"']+)\1/g;
const STATIC_BARE_RE = /\bimport\s*(["'])([^"']+)\1/g;
const DYNAMIC_RE = /\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g;

/** @param {string} code @returns {string[]} */
function staticSpecs(code) {
  const specs = [];
  for (const m of code.matchAll(STATIC_FROM_RE)) specs.push(m[2]);
  for (const m of code.matchAll(STATIC_BARE_RE)) specs.push(m[2]);
  return specs;
}

/** @param {string} code @returns {string[]} */
function dynamicSpecs(code) {
  return [...code.matchAll(DYNAMIC_RE)].map((m) => m[2]);
}

/** @type {Map<string, string>} */
const fileCache = new Map();
/** @param {string} abs */
async function readCached(abs) {
  let text = fileCache.get(abs);
  if (text === undefined) {
    text = await readFile(abs, 'utf8');
    fileCache.set(abs, text);
  }
  return text;
}

/**
 * Transitive closure over STATIC imports only.
 * @param {Iterable<string>} roots absolute paths
 * @returns {Promise<Set<string>>} existing files in the closure
 */
async function staticClosure(roots) {
  /** @type {Set<string>} */
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file) || !(await exists(file))) continue;
    seen.add(file);
    if (!/\.m?js$/i.test(file)) continue;
    const code = await readCached(file);
    for (const spec of staticSpecs(code)) {
      const target = resolveLocal(spec, path.dirname(file));
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

/** @param {string} code */
function hasThreeMarker(code) {
  return THREE_MARKERS.some((marker) => code.includes(marker));
}

// ---------------------------------------------------------------------------------------------------------------------
// Load dist and baseline
// ---------------------------------------------------------------------------------------------------------------------

if (!(await exists(path.join(DIST, 'index.html')))) {
  fatal(`${path.relative(ROOT, DIST) || DIST} has no index.html. Run \`npm run build\` first.`);
}
if (!(await exists(BASELINE))) fatal(`baseline not found: ${path.relative(ROOT, BASELINE)}`);

/** @type {{ routes: string[], text: Record<string, string>, hrefs: Record<string, string[]>, notFound?: { file: string, text: string, hrefs: string[] } }} */
const baseline = JSON.parse(await readFile(BASELINE, 'utf8'));

const htmlFiles = await listDistHtml(DIST);
const builtRoutes = listRoutes(htmlFiles);

/**
 * @typedef {{ file: string, route: string | null, html: string, tokens: ReturnType<typeof tokenize> }} Page
 */
/** @type {Page[]} */
const pages = [];
for (const file of htmlFiles) {
  const html = await readFile(path.join(DIST, file), 'utf8');
  pages.push({ file, route: routeFromIndexPath(file), html, tokens: tokenize(html) });
}
/** @param {string} route */
const pageFor = (route) => pages.find((p) => p.route === route);

// 1. Routes preserved --------------------------------------------------------------------------------------------------
{
  const problems = [];
  const missing = setDiff(baseline.routes, builtRoutes);
  const extra = setDiff(builtRoutes, baseline.routes);
  if (missing.length > 0) problems.push(`missing routes: ${missing.join(', ')}`);
  if (extra.length > 0) problems.push(`unexpected routes: ${extra.join(', ')}`);
  record('Routes preserved', problems, { note: `${builtRoutes.length} routes match the baseline` });
}

// 2. Copy preserved (visible text) and 3. Links preserved (href sets) ---------------------------------------------------
{
  const textProblems = [];
  const hrefProblems = [];
  let compared = 0;

  /** @param {string} label @param {Page | undefined} page @param {string | undefined} wantText @param {string[] | undefined} wantHrefs */
  const compare = (label, page, wantText, wantHrefs) => {
    if (page === undefined) {
      textProblems.push(`${label}: not built`);
      return;
    }
    compared += 1;
    const gotText = extractVisibleText(page.html);
    if (wantText === undefined) textProblems.push(`${label}: no baseline text`);
    else if (gotText !== wantText) textProblems.push(`${label}: text differs ${firstDiff(wantText, gotText)}`);
    const gotHrefs = extractHrefs(page.html);
    if (wantHrefs === undefined) hrefProblems.push(`${label}: no baseline hrefs`);
    else {
      const gone = setDiff(wantHrefs, gotHrefs);
      const added = setDiff(gotHrefs, wantHrefs);
      if (gone.length > 0 || added.length > 0) {
        hrefProblems.push(`${label}: removed [${gone.join(', ')}] added [${added.join(', ')}]`);
      }
    }
  };

  for (const route of baseline.routes) {
    compare(route, pageFor(route), baseline.text[route], baseline.hrefs[route]);
  }
  if (baseline.notFound === undefined) {
    textProblems.push('baseline has no notFound entry');
    hrefProblems.push('baseline has no notFound entry');
  } else {
    compare(
      `${baseline.notFound.file} (404)`,
      pages.find((p) => p.file === baseline.notFound?.file),
      baseline.notFound.text,
      baseline.notFound.hrefs,
    );
  }
  record('Copy preserved (visible text)', textProblems, { note: `${compared} pages incl. 404 match the baseline` });
  record('Links preserved (<a href> sets)', hrefProblems, { note: `${compared} pages incl. 404 match the baseline` });
}

// 4. No external scripts ---------------------------------------------------------------------------------------------------
{
  const problems = [];
  for (const page of pages) {
    for (const load of scanExternalScripts(page.html)) problems.push(`${page.file}: ${load.kind} ${load.url}`);
  }
  record('No external <script src> / modulepreload / import()', problems, { note: `${pages.length} HTML files scanned` });
}

// Roots (scripts each page loads eagerly) --------------------------------------------------------------------------------

/**
 * @typedef {{ roots: string[], inline: string[], missing: string[] }} PageScripts
 */
/** @param {Page} page @returns {Promise<PageScripts>} */
async function pageScripts(page) {
  const pageDir = path.dirname(path.join(DIST, page.file));
  /** @type {PageScripts} */
  const out = { roots: [], inline: [], missing: [] };
  for (const token of page.tokens) {
    if (token.type === 'open' && token.name === 'script') {
      const src = token.attrs.get('src');
      const type = (token.attrs.get('type') ?? '').toLowerCase();
      if (src === undefined || type === 'application/ld+json') continue;
      const abs = resolveLocal(src, pageDir);
      if (abs === null) continue;
      if (await exists(abs)) out.roots.push(abs);
      else out.missing.push(src);
    } else if (token.type === 'open' && token.name === 'link') {
      const rel = (token.attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
      const href = token.attrs.get('href');
      if (rel.includes('modulepreload') && href !== undefined) {
        const abs = resolveLocal(href, pageDir);
        if (abs !== null && (await exists(abs))) out.roots.push(abs);
      }
    } else if (token.type === 'raw' && token.name === 'script') {
      out.inline.push(token.text);
    }
  }
  return out;
}

/** @type {Map<string, PageScripts>} */
const scriptsByFile = new Map();
/** @type {Map<string, Set<string>>} */
const closureByFile = new Map();
for (const page of pages) {
  const scripts = await pageScripts(page);
  scriptsByFile.set(page.file, scripts);
  // Static imports inside inline module scripts are eager too.
  const inlineRoots = [];
  const pageDir = path.dirname(path.join(DIST, page.file));
  for (const code of scripts.inline) {
    for (const spec of staticSpecs(code)) {
      const target = resolveLocal(spec, pageDir);
      if (target !== null) inlineRoots.push(target);
    }
  }
  closureByFile.set(page.file, await staticClosure([...scripts.roots, ...inlineRoots]));
}

// 5. `three` not in the initial JS (+ positive control) ---------------------------------------------------------------------
/** @param {Page} page */
const scenesIn = (page) =>
  page.tokens.filter((t) => t.type === 'open' && (t.attrs.get('class') ?? '').split(/\s+/).includes('scene')).length;
const sceneCount = pages.reduce((n, page) => n + scenesIn(page), 0);
const homePage = pageFor('/');
const homeSceneCount = homePage === undefined ? 0 : scenesIn(homePage);
/** Filled by the `three` checks below, used by the lazy-chunk report. @type {Set<string>} */
const eager = new Set();
/** @type {Set<string>} */
let lazy = new Set();
{
  const problems = [];
  for (const page of pages) {
    const scripts = /** @type {PageScripts} */ (scriptsByFile.get(page.file));
    for (const s of scripts.missing) problems.push(`${page.file}: referenced script not found in dist: ${s}`);
    for (const code of scripts.inline) {
      const hit = THREE_MARKERS.find((m) => code.includes(m));
      if (hit !== undefined) problems.push(`${page.file}: inline script contains \`${hit}\``);
    }
    for (const file of /** @type {Set<string>} */ (closureByFile.get(page.file))) {
      eager.add(file);
      if (/\.m?js$/i.test(file)) {
        const hit = THREE_MARKERS.find((m) => (fileCache.get(file) ?? '').includes(m));
        if (hit !== undefined) problems.push(`${page.file}: eager script ${path.relative(DIST, file)} contains \`${hit}\``);
      }
    }
  }
  record('`three` absent from the static-import closure of every page', problems, {
    note: `${eager.size} eager files scanned, markers: ${THREE_MARKERS.join(', ')}`,
  });

  // Positive control: the markers must exist somewhere, and only behind a dynamic import().
  const astroJs = await walkFiles(path.join(DIST, '_astro'), (n) => /\.m?js$/i.test(n));
  const markerChunks = [];
  for (const file of astroJs) if (hasThreeMarker(await readCached(file))) markerChunks.push(file);

  const controlProblems = [];
  let vacuous = false;
  let note = '';
  if (markerChunks.length === 0) {
    if (SCENES_MANDATORY) {
      controlProblems.push('no chunk in dist/_astro contains the `three` markers, so the check above proves nothing');
    } else {
      vacuous = true;
      note = `VACUOUS: no chunk in dist/_astro contains ${THREE_MARKERS.join(' / ')} yet (three is not imported before Phase 3)`;
    }
  } else {
    /** @type {string[]} */
    const dynamicRoots = [];
    for (const file of astroJs) {
      for (const spec of dynamicSpecs(await readCached(file))) {
        const target = resolveLocal(spec, path.dirname(file));
        if (target !== null) dynamicRoots.push(target);
      }
    }
    for (const page of pages) {
      const pageDir = path.dirname(path.join(DIST, page.file));
      for (const code of /** @type {PageScripts} */ (scriptsByFile.get(page.file)).inline) {
        for (const spec of dynamicSpecs(code)) {
          const target = resolveLocal(spec, pageDir);
          if (target !== null) dynamicRoots.push(target);
        }
      }
      // Astro islands load their component and renderer with `import(url)` from an attribute (hydration, not eager).
      for (const token of page.tokens) {
        if (token.type !== 'open' || token.name !== 'astro-island') continue;
        for (const attr of ['component-url', 'renderer-url']) {
          const url = token.attrs.get(attr);
          const target = url === undefined ? null : resolveLocal(url, pageDir);
          if (target !== null) dynamicRoots.push(target);
        }
      }
    }
    lazy = await staticClosure(dynamicRoots);
    for (const chunk of markerChunks) {
      const name = path.relative(DIST, chunk);
      if (eager.has(chunk)) controlProblems.push(`${name} has the markers but is eagerly loaded`);
      else if (!lazy.has(chunk)) controlProblems.push(`${name} has the markers but no dynamic import() reaches it`);
    }
    note = `${markerChunks.length} marker chunk(s), all reachable only through dynamic import()`;
  }
  record('Positive control: `three` chunk exists and is dynamic-only', controlProblems, { vacuous, note });
}

// 6. Scene accessibility (+ canvas) and reserved space ----------------------------------------------------------------------
/** @param {Map<string, string>} attrs */
function isHiddenOrLabelledImage(attrs) {
  if (attrs.get('aria-hidden') === 'true') return true;
  return attrs.get('role') === 'img' && (attrs.get('aria-label') ?? '').trim() !== '';
}

/**
 * CSS text of one page (linked local stylesheets + inline styles).
 * @param {{ file: string, tokens: ReturnType<typeof tokenize> }} page
 * @returns {Promise<string>}
 */
async function pageCss(page) {
  const pageDir = path.dirname(path.join(DIST, page.file));
  let css = '';
  for (const token of page.tokens) {
    if (token.type === 'open' && token.name === 'link') {
      const rel = (token.attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
      const href = token.attrs.get('href');
      if (rel.includes('stylesheet') && href !== undefined) {
        const abs = resolveLocal(href, pageDir);
        if (abs !== null && (await exists(abs))) css += `\n${await readCached(abs)}`;
      }
    } else if (token.type === 'raw' && token.name === 'style') {
      css += `\n${token.text}`;
    }
  }
  return css;
}

/** True when some rule whose selector names `.scene` sets `aspect-ratio`. @param {string} css */
function sceneHasAspectRatio(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.scene(?![\w-])/.test(m[1]) && /(?:^|[;\s])aspect-ratio\s*:/.test(m[2])) return true;
  }
  return false;
}

{
  const a11yProblems = [];
  const spaceProblems = [];
  let canvases = 0;

  for (const page of pages) {
    /** @type {{ name: string, ok: boolean }[]} */
    const stack = [];
    let scenesOnPage = 0;
    for (const token of page.tokens) {
      if (token.type === 'open') {
        const isScene = (token.attrs.get('class') ?? '').split(/\s+/).includes('scene');
        const ok = isHiddenOrLabelledImage(token.attrs);
        if (isScene) {
          scenesOnPage += 1;
          if (!ok) a11yProblems.push(`${page.file}: .scene without aria-hidden="true" or role="img" + aria-label`);
        }
        if (token.name === 'canvas') {
          canvases += 1;
          if (!ok && !stack.some((e) => e.ok)) {
            a11yProblems.push(`${page.file}: <canvas> neither aria-hidden nor inside an aria-hidden / labelled-image element`);
          }
        }
        if (!token.selfClosing) stack.push({ name: token.name, ok });
      } else if (token.type === 'close') {
        for (let i = stack.length - 1; i >= 0; i -= 1) {
          if (stack[i].name === token.name) {
            stack.length = i;
            break;
          }
        }
      }
    }
    if (scenesOnPage > 0 && !sceneHasAspectRatio(await pageCss(page))) {
      spaceProblems.push(`${page.file}: ${scenesOnPage} .scene element(s) but no \`.scene\` rule with aspect-ratio in the built CSS`);
    }
  }

  if (SCENES_MANDATORY) {
    const homeProblems = [];
    if (homePage === undefined) homeProblems.push('home route `/` is not built');
    else if (homeSceneCount === 0) homeProblems.push('home route `/` contains no `.scene` element (mandatory from Phase 3)');
    record('Home route `/` contains a .scene', homeProblems, { note: `${homeSceneCount} .scene element(s) on /` });
    if (sceneCount === 0) {
      a11yProblems.push('no .scene element in any built page (mandatory from Phase 3)');
      spaceProblems.push('no .scene element in any built page (mandatory from Phase 3)');
    }
  }
  const noScenes = sceneCount === 0 && !SCENES_MANDATORY;
  record('Scene a11y: .scene and <canvas> hidden or labelled', a11yProblems, {
    vacuous: noScenes && canvases === 0,
    note: noScenes
      ? `${canvases} <canvas> element(s) checked; VACUOUS for .scene (none exists before Phase 3)`
      : `${sceneCount} .scene and ${canvases} <canvas> checked`,
  });
  record('Reserved space: every .scene has an aspect-ratio rule', spaceProblems, {
    vacuous: noScenes,
    note: noScenes ? 'VACUOUS: no .scene element exists before Phase 3' : `${sceneCount} .scene element(s) checked`,
  });
}

// 7. Sign-in inert ------------------------------------------------------------------------------------------------------------
{
  const problems = [];
  const signin = pageFor('/signin/');
  let forms = 0;
  if (signin === undefined) problems.push('/signin/ is not built');
  else {
    const robots = signin.tokens.find(
      (t) => t.type === 'open' && t.name === 'meta' && (t.attrs.get('name') ?? '').toLowerCase() === 'robots',
    );
    const content = robots?.type === 'open' ? (robots.attrs.get('content') ?? '').toLowerCase() : '';
    if (!/\bnoindex\b/.test(content)) problems.push('/signin/ has no <meta name="robots"> containing noindex');
    for (const t of signin.tokens) {
      if (t.type === 'open' && t.name === 'form') {
        forms += 1;
        if (!t.attrs.has('novalidate')) problems.push(`/signin/ <form id="${t.attrs.get('id') ?? ''}"> has no novalidate`);
      }
    }
  }
  for (const page of pages) {
    if (page.route === '/signin/') continue;
    for (const href of extractHrefs(page.html)) {
      const pathOnly = cleanUrl(href.replace(/^https?:\/\/(?:www\.)?orgs\.social(?=\/|$)/i, ''));
      if (/^\/signin\/?$/i.test(pathOnly)) problems.push(`${page.file} links to ${href}`);
    }
  }
  record('Sign-in inert: noindex, novalidate forms, unlinked', problems, {
    note: `/signin/ noindex, ${forms} form(s) with novalidate, no other page links to it`,
  });
}

// 8. Navbar toggle ----------------------------------------------------------------------------------------------------------------
{
  const problems = [];
  for (const page of pages) {
    const ids = new Set(page.tokens.flatMap((t) => (t.type === 'open' && t.attrs.has('id') ? [t.attrs.get('id')] : [])));
    const button = page.tokens.find(
      (t) =>
        t.type === 'open' &&
        t.name === 'button' &&
        (t.attrs.get('id') === 'mobile-menu-toggle' || (t.attrs.get('class') ?? '').split(/\s+/).includes('mobile-toggle')),
    );
    if (button === undefined || button.type !== 'open') {
      problems.push(`${page.file}: menu button (#mobile-menu-toggle) not found`);
      continue;
    }
    if (!button.attrs.has('aria-expanded')) problems.push(`${page.file}: menu button has no aria-expanded`);
    const controls = (button.attrs.get('aria-controls') ?? '').trim();
    if (controls === '') problems.push(`${page.file}: menu button has no aria-controls`);
    else if (!ids.has(controls)) problems.push(`${page.file}: aria-controls="${controls}" points to no element id`);
  }
  record('Navbar menu button has aria-expanded and aria-controls', problems, { note: `${pages.length} pages incl. 404` });
}

// 9. Fonts self-hosted ---------------------------------------------------------------------------------------------------------------
{
  const problems = [];
  let preloads = 0;
  for (const page of pages) {
    for (const t of page.tokens) {
      if (t.type !== 'open' || t.name !== 'link') continue;
      const rel = (t.attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
      if (!rel.includes('preload') || (t.attrs.get('as') ?? '').toLowerCase() !== 'font') continue;
      preloads += 1;
      const href = t.attrs.get('href') ?? '';
      if (!isRootRelative(href)) problems.push(`${page.file}: font preload is not root-relative: ${href}`);
      else if (!(await exists(path.join(DIST, cleanUrl(href))))) problems.push(`${page.file}: preloaded font not in dist: ${href}`);
    }
  }

  const cssFiles = await walkFiles(DIST, (n) => /\.css$/i.test(n));
  /** @type {{ label: string, text: string }[]} */
  const cssSources = [];
  for (const f of cssFiles) cssSources.push({ label: path.relative(DIST, f), text: await readCached(f) });
  for (const page of pages) {
    const inline = page.tokens.flatMap((t) => (t.type === 'raw' && t.name === 'style' ? [t.text] : []));
    if (inline.length > 0) cssSources.push({ label: `${page.file} <style>`, text: inline.join('\n') });
  }

  let interFaces = 0;
  for (const { label, text } of cssSources) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/@font-face\s*\{([^{}]*)\}/gi)) {
      if (!/font-family\s*:\s*(["']?)Inter Tight\1\s*(?:;|$)/i.test(m[1])) continue;
      interFaces += 1;
      for (const u of m[1].matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
        const url = u[2];
        if (!isRootRelative(url)) problems.push(`${label}: Inter Tight src is not root-relative: ${url}`);
        else if (!(await exists(path.join(DIST, cleanUrl(url))))) problems.push(`${label}: Inter Tight file missing in dist: ${url}`);
      }
    }
  }
  if (interFaces === 0) problems.push('built CSS has no `Inter Tight` @font-face');

  const hostRe = /fonts\.googleapis|fonts\.gstatic|use\.typekit\.net|fonts\.bunny\.net|use\.fontawesome\.com|kit\.fontawesome\.com/i;
  const fileUrlRe = /(?:https?:)?\/\/[^"'\s)]+\.(?:woff2?|ttf|otf|eot)(?=[?#"'\s)]|$)/i;
  const cssExternalRe = /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//i;
  for (const page of pages) {
    const m = hostRe.exec(page.html) ?? fileUrlRe.exec(page.html);
    if (m !== null) problems.push(`${page.file}: external font URL: ${excerpt(m[0])}`);
  }
  for (const { label, text } of cssSources) {
    const m = hostRe.exec(text) ?? fileUrlRe.exec(text) ?? cssExternalRe.exec(text);
    if (m !== null) problems.push(`${label}: external font/import URL: ${excerpt(m[0])}`);
    for (const face of text.matchAll(/@font-face\s*\{([^{}]*)\}/gi)) {
      const ext = /url\(\s*["']?((?:https?:)?\/\/[^"')]+)/i.exec(face[1]);
      if (ext !== null) problems.push(`${label}: @font-face src is external: ${excerpt(ext[1])}`);
    }
  }
  record('Fonts self-hosted (preload, Inter Tight @font-face, no external font URL)', problems, {
    note: `${preloads} font preload(s), ${interFaces} Inter Tight @font-face block(s), ${cssSources.length} CSS sources`,
  });
}

// 10. Router marker ---------------------------------------------------------------------------------------------------------------------
{
  const problems = [];
  const withMarker = [];
  for (const page of pages) {
    const has = page.tokens.some(
      (t) =>
        t.type === 'open' &&
        t.name === 'meta' &&
        t.attrs.get('name') === ROUTER_META_NAME &&
        (t.attrs.get('content') ?? '') === 'true',
    );
    if (has) withMarker.push(page.file);
    if (ROUTER_EXPECTED && !has) problems.push(`${page.file}: view-transitions marker missing`);
    if (!ROUTER_EXPECTED && has) problems.push(`${page.file}: has the view-transitions marker before Phase 3`);
  }
  record(
    ROUTER_EXPECTED ? 'Router marker present on every page (--router=present)' : 'Router marker absent (--router=absent)',
    problems,
    {
      note: ROUTER_EXPECTED
        ? `${withMarker.length}/${pages.length} pages carry <meta name="${ROUTER_META_NAME}">`
        : `none of ${pages.length} pages carries <meta name="${ROUTER_META_NAME}">`,
    },
  );
}

// 10b. client:visible islands must have an observable child ---------------------------------------------------------------------------
// Astro's `client:visible` directive (astro/dist/runtime/client/visible.js) runs an IntersectionObserver over
// `el.children` of the <astro-island> only, because the island itself is `display: contents`. An island whose server
// render is empty has no children, so nothing is observed and it never hydrates. Children that can never intersect do
// not count: elements that are never rendered (script, style, template, ...), `display: contents` slot wrappers, and
// anything with the `hidden` attribute (display: none).
const NON_OBSERVABLE_CHILDREN = new Set([
  'script',
  'style',
  'template',
  'link',
  'meta',
  'noscript',
  'astro-slot',
  'astro-static-slot',
]);
{
  const problems = [];
  let visibleIslands = 0;
  for (const page of pages) {
    /** Open <astro-island> frames: tag depth below the island, and whether it is client="visible". */
    /** @type {{ visible: boolean, depth: number, observable: number, label: string }[]} */
    const islands = [];
    for (const token of page.tokens) {
      const top = islands[islands.length - 1];
      if (token.type === 'open') {
        if (top !== undefined && top.visible && top.depth === 0) {
          const hidden = token.attrs.has('hidden');
          if (!NON_OBSERVABLE_CHILDREN.has(token.name) && !hidden) top.observable += 1;
        }
        if (token.name === 'astro-island' && !token.selfClosing) {
          if (top !== undefined) top.depth += 1; // a nested island is a descendant of the outer one
          const visible = (token.attrs.get('client') ?? '') === 'visible';
          const url = token.attrs.get('component-url') ?? '(no component-url)';
          if (visible) visibleIslands += 1;
          islands.push({ visible, depth: 0, observable: 0, label: `${page.file}: ${url}` });
        } else if (top !== undefined && !token.selfClosing) {
          top.depth += 1;
        }
      } else if (token.type === 'close' && top !== undefined) {
        if (token.name === 'astro-island' && top.depth === 0) {
          islands.pop();
          if (top.visible && top.observable === 0) {
            problems.push(
              `${top.label}: <astro-island client="visible"> has no observable child element. Astro's client:visible ` +
                `observes only the island's children, so this island would never hydrate. Render one laid-out element ` +
                `(not hidden, not display: none) from the first server render.`,
            );
          }
          const outer = islands[islands.length - 1];
          if (outer !== undefined) outer.depth -= 1;
        } else if (top.depth > 0) {
          top.depth -= 1;
        }
      }
    }
  }
  record('Every client:visible <astro-island> has an observable child element', problems, {
    note: `${visibleIslands} client="visible" island(s) checked`,
  });
}

// 11. Payload report (no failure threshold) ---------------------------------------------------------------------------------------------
/** @type {{ route: string, files: number, bytes: number, raw: number }[]} */
const payload = [];
for (const page of pages) {
  const closure = /** @type {Set<string>} */ (closureByFile.get(page.file));
  const scripts = /** @type {PageScripts} */ (scriptsByFile.get(page.file));
  let bytes = 0;
  let raw = 0;
  let files = 0;
  for (const file of closure) {
    if (!/\.m?js$/i.test(file)) continue;
    const buf = Buffer.from(await readCached(file), 'utf8');
    bytes += gzipSync(buf).length;
    raw += buf.length;
    files += 1;
  }
  for (const code of scripts.inline) {
    if (code.trim() === '') continue;
    const buf = Buffer.from(code, 'utf8');
    bytes += gzipSync(buf).length;
    raw += buf.length;
    files += 1;
  }
  payload.push({ route: page.route ?? `/${page.file}`, files, bytes, raw });
}

// ---------------------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------------------

console.log(`verify-dist  dist=${path.relative(ROOT, DIST) || '.'}  phase=${PHASE}  pages=${pages.length}`);
console.log('');
for (const r of results) {
  const tag = !r.ok ? 'FAIL' : r.vacuous ? 'PASS (vacuous)' : 'PASS';
  console.log(`${tag.padEnd(15)} ${r.name}`);
  for (const d of r.details) console.log(`${' '.repeat(16)}${d}`);
}

console.log('');
console.log('Eager JS payload per route (report only)');
const width = Math.max(...payload.map((p) => p.route.length), 5);
console.log(`  ${'route'.padEnd(width)}  files  ${'raw B'.padStart(8)}  ${'gzip B'.padStart(8)}  gzip KB`);
for (const p of payload) {
  console.log(
    `  ${p.route.padEnd(width)}  ${String(p.files).padStart(5)}  ${String(p.raw).padStart(8)}  ${String(p.bytes).padStart(8)}  ${(p.bytes / 1024).toFixed(1).padStart(7)}`,
  );
}

{
  console.log('');
  console.log('Lazy JS chunks (reachable only through dynamic import / island hydration; raw and gzip bytes, report only)');
  const rows = [];
  for (const file of [...lazy].filter((f) => /\.m?js$/i.test(f) && !eager.has(f)).sort()) {
    const code = await readCached(file);
    const buf = Buffer.from(code, 'utf8');
    const markers = THREE_MARKERS.filter((m) => code.includes(m));
    rows.push({ name: path.relative(DIST, file), raw: buf.length, gzip: gzipSync(buf).length, markers });
  }
  const nameWidth = Math.max(...rows.map((r) => r.name.length), 5);
  console.log(`  ${'chunk'.padEnd(nameWidth)}  ${'raw B'.padStart(9)}  ${'gzip B'.padStart(9)}  three markers`);
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(nameWidth)}  ${String(r.raw).padStart(9)}  ${String(r.gzip).padStart(9)}  ${r.markers.join(', ') || '-'}`,
    );
  }
  console.log(
    `  ${'total'.padEnd(nameWidth)}  ${String(rows.reduce((n, r) => n + r.raw, 0)).padStart(9)}  ${String(rows.reduce((n, r) => n + r.gzip, 0)).padStart(9)}`,
  );
}

const failed = results.filter((r) => !r.ok);
const vacuous = results.filter((r) => r.vacuous);
console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed, ${vacuous.length} vacuously, ${failed.length} failed.`);
if (vacuous.length > 0) console.log(`Vacuous (run with --phase=3 to make them mandatory): ${vacuous.map((r) => r.name).join('; ')}`);
process.exit(failed.length > 0 ? 1 : 0);
