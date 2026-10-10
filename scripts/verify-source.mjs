// verify-source: scans the source tree against the upgrade rules and runs the smoke checks.
// Built-ins only. The rule functions live in scripts/lib/ (scan-rules, scan-colours, scan-motion, scan-types, contrast).
//
//   node scripts/verify-source.mjs [--strict] [--phase=<1..5>] [--write-baseline]
//
//   --strict           ignore scripts/verify-baseline.json: every finding fails (CI switches to this in Phase 5).
//   --phase            default 3 (the current phase; task 3.18 flipped it from 2 to 3). Switches the checks that change over the upgrade:
//                      phase 1 and 2: no ClientRouter / astro:transitions in src/;
//                      phase 3 and later: ClientRouter appears exactly once, in BaseLayout.astro (every other src/ file is forbidden);
//                      phase 2 and later: public/vendor/particles.min.js must be gone; Card.astro has no box-shadow;
//                        a solid fill only under the `filled` Button variant (rules in scripts/lib/scan-phase2.mjs);
//                      phase 2 only: `variant="filled"` appears 0 times in src/; phase 3 and later: exactly once, in src/pages/index.astro.
//   --write-baseline   regenerate scripts/verify-baseline.json from the current findings (keeps existing notes).
//
// Scan scope: src/** (.astro .ts .tsx .css, plus any .js/.mjs/.jsx/.mts), public/**/*.js, astro.config.mjs.
// Excluded: tokens.css for the colour rule only (done inside scanColours), node_modules, dist, refrence, scripts, tests.
//
// Burn-down baseline: known violations are recorded as { rule, file, count }. The scan fails when a count rises
// (new violation) and when a count falls below its entry ("baseline is stale", delete or lower the entry).
// Exit code 0 when every check passes, 1 otherwise.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContrastPairs, readTokenValues } from './lib/contrast.mjs';
import { checkButtonRule, checkCardRule, checkFilledCount } from './lib/scan-phase2.mjs';
import { collectAnimationNames, scanFile, scanFontSizeBudget } from './lib/scan-rules.mjs';
import { getRegions, iterTags, kindOfFile, normalisePath, withoutComments } from './lib/scan-util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} name @returns {string | undefined} */
function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}
/** @param {string} name */
const flag = (name) => process.argv.slice(2).includes(`--${name}`);

const STRICT = flag('strict');
const WRITE_BASELINE = flag('write-baseline');
const PHASE = Number.parseInt(arg('phase') ?? '3', 10);

const BASELINE_FILE = path.join(ROOT, 'scripts', 'verify-baseline.json');
const PAIRS_FILE = path.join(ROOT, 'scripts', 'contrast-pairs.json');
const HASHES_FILE = path.join(ROOT, '.kiro', 'specs', 'frontend-3d-upgrade', 'reference-hashes.json');
const TOKENS_PATH = 'src/styles/tokens.css';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'refrence', 'scripts', 'tests', '.git', '.astro', '.kiro']);
const SRC_EXTENSIONS = new Set(['.astro', '.ts', '.tsx', '.css', '.js', '.mjs', '.jsx', '.mts']);

/** @type {{ name: string, problems: string[], notes: string[], skipped?: boolean }[]} */
const checks = [];

/**
 * @param {string} name
 * @param {string[]} problems empty means pass
 * @param {{ notes?: string[], skipped?: boolean }} [opts]
 */
function record(name, problems, opts = {}) {
  checks.push({ name, problems, notes: opts.notes ?? [], skipped: opts.skipped });
}

// ---------------------------------------------------------------------------
// File system
// ---------------------------------------------------------------------------

/** @param {string} rel repo-relative path */
const abs = (rel) => path.join(ROOT, ...rel.split('/'));
/** @param {string} rel */
const exists = (rel) => existsSync(abs(rel));
/** @param {string} rel */
const read = (rel) => readFileSync(abs(rel), 'utf8');

/**
 * @param {string} rel repo-relative directory
 * @param {(file: string) => boolean} keep
 * @returns {string[]} repo-relative paths, sorted
 */
function walk(rel, keep) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function visit(dir) {
    let entries;
    try {
      entries = readdirSync(abs(dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(child);
      } else if (entry.isFile() && keep(child)) {
        out.push(child);
      }
    }
  }
  visit(rel);
  return out.sort();
}

const extOf = (file) => path.extname(file).toLowerCase();

function listScanFiles() {
  const files = [
    ...walk('src', (f) => SRC_EXTENSIONS.has(extOf(f))),
    ...walk('public', (f) => ['.js', '.mjs'].includes(extOf(f))),
  ];
  if (exists('astro.config.mjs')) files.push('astro.config.mjs');
  return files.sort();
}

/** @param {string[]} args @returns {string | null} stdout, or null when the command fails */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Rule scan + baseline
// ---------------------------------------------------------------------------

/** @typedef {import('./lib/scan-rules.mjs').FileHit} FileHit */

const scanFiles = listScanFiles();
/** @type {Array<{ file: string, text: string }>} */
const sources = scanFiles.map((file) => ({ file, text: read(file) }));

const animationNames = new Set();
for (const { file, text } of sources) {
  const kind = kindOfFile(file);
  if (kind === 'css' || kind === 'astro') for (const n of collectAnimationNames(text, kind)) animationNames.add(n);
}
const scanCtx = { exists, animationNames };

/** @type {FileHit[]} */
const allHits = [];
for (const { file, text } of sources) allHits.push(...scanFile({ file, text, ctx: scanCtx }));
allHits.push(...scanFontSizeBudget(sources.filter((s) => ['css', 'astro'].includes(kindOfFile(s.file) ?? '')), read(TOKENS_PATH), TOKENS_PATH));

/** @type {Map<string, FileHit[]>} */
const grouped = new Map();
for (const hit of allHits) {
  const key = `${hit.rule}\u0000${hit.file}`;
  const list = grouped.get(key) ?? [];
  list.push(hit);
  grouped.set(key, list);
}
const splitKey = (key) => key.split('\u0000');

/** @returns {{ rule: string, file: string, count: number, note?: string }[]} */
function loadBaseline() {
  if (!exists('scripts/verify-baseline.json')) return [];
  const data = JSON.parse(read('scripts/verify-baseline.json'));
  if (!data || !Array.isArray(data.entries)) throw new Error('scripts/verify-baseline.json: expected { entries: [...] }');
  for (const e of data.entries) {
    if (typeof e.rule !== 'string' || typeof e.file !== 'string' || !Number.isInteger(e.count) || e.count < 1) {
      throw new Error(`scripts/verify-baseline.json: bad entry ${JSON.stringify(e)}`);
    }
  }
  return data.entries;
}

if (WRITE_BASELINE) {
  const previous = new Map(loadBaseline().map((e) => [`${e.rule}\u0000${e.file}`, e]));
  const entries = [...grouped.entries()]
    .map(([key, hits]) => {
      const [rule, file] = splitKey(key);
      const note = previous.get(key)?.note;
      return note === undefined ? { rule, file, count: hits.length } : { rule, file, count: hits.length, note };
    })
    .sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file));
  const body = {
    note: 'Burn-down baseline for scripts/verify-source.mjs: known violations as { rule, file, count }. A count that rises fails (new violation); a count that falls below its entry fails too ("baseline is stale"), so delete or lower the entry in the phase that fixes it. `npm run verify:source -- --strict` ignores this file. Regenerate with `node scripts/verify-source.mjs --write-baseline` after reviewing the findings.',
    entries,
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`verify-source: wrote ${entries.length} baseline entries (${allHits.length} findings) to scripts/verify-baseline.json`);
  process.exit(0);
}

/** @param {FileHit} h */
const fmtHit = (h) => `${h.rule}  ${h.file}:${h.line}:${h.column}  ${h.match}${h.detail ? `  (${h.detail})` : ''}`;

{
  const baseline = STRICT ? [] : loadBaseline();
  const baselineMap = new Map(baseline.map((e) => [`${e.rule}\u0000${e.file}`, e]));
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  let baselined = 0;
  for (const [key, hits] of grouped) {
    const allowed = baselineMap.get(key)?.count ?? 0;
    if (hits.length > allowed) {
      problems.push(allowed === 0 ? `${hits.length} finding(s)` : `${hits.length} finding(s), baseline allows ${allowed}`);
      for (const h of hits) problems.push(`  ${fmtHit(h)}`);
    } else {
      baselined += hits.length;
    }
  }
  for (const [key, entry] of baselineMap) {
    const [rule, file] = splitKey(key);
    const actual = grouped.get(key)?.length ?? 0;
    if (actual < entry.count) problems.push(`baseline is stale: ${rule}  ${file}: baseline ${entry.count}, found ${actual}. Lower or delete the entry.`);
  }
  if (!STRICT) notes.push(`${baselined} finding(s) in ${baselineMap.size} baseline entries (burn-down)`);
  notes.push(`${scanFiles.length} files scanned${STRICT ? ', --strict (baseline ignored)' : ''}`);
  record('Source rules (colour, motion, types, console, network, imports, fonts, font sizes, listeners)', problems, { notes });
}

// ---------------------------------------------------------------------------
// 2. Package rules (R5, R10)
// ---------------------------------------------------------------------------

const APPROVED_RUNTIME = new Set([
  'gsap', 'lenis', 'three', '@react-three/fiber', '@react-three/drei', '@astrojs/react',
  '@fontsource-variable/inter-tight', '@fontsource/inter-tight', 'react', 'react-dom',
]);
const APPROVED_DEV = new Set(['@types/react', '@types/react-dom', '@types/three']);
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const BANNED_PACKAGE = [/^tailwindcss$/, /^@tailwindcss\//, /^framer-motion$/, /^motion$/, /^@radix-ui\//, /^shadcn/, /^@shadcn\//];

const hashesFile = existsSync(HASHES_FILE) ? JSON.parse(readFileSync(HASHES_FILE, 'utf8')) : null;
const BASE_COMMIT = hashesFile?.baseCommit ?? null;
const baseResolvable = BASE_COMMIT !== null && git(['cat-file', '-e', `${BASE_COMMIT}^{commit}`]) !== null;

{
  const pkg = JSON.parse(read('package.json'));
  const deps = pkg.dependencies ?? {};
  const devDeps = pkg.devDependencies ?? {};
  /** @type {Record<string, string>} */
  let baseDeps = {};
  /** @type {Record<string, string>} */
  let baseDev = {};
  const problems = [];
  const notes = [];
  if (baseResolvable) {
    const basePkgText = git(['show', `${BASE_COMMIT}:package.json`]);
    if (basePkgText !== null) {
      const basePkg = JSON.parse(basePkgText);
      baseDeps = basePkg.dependencies ?? {};
      baseDev = basePkg.devDependencies ?? {};
    }
  } else {
    problems.push(`phase base commit ${BASE_COMMIT ?? '(missing from reference-hashes.json)'} is not available, so "new" dependencies cannot be told from existing ones (CI needs fetch-depth: 0)`);
  }
  const newRuntime = Object.keys(deps).filter((n) => !(n in baseDeps));
  const newDev = Object.keys(devDeps).filter((n) => !(n in baseDev));
  for (const name of newRuntime) {
    if (!APPROVED_RUNTIME.has(name)) problems.push(`runtime dependency "${name}" is not an Approved_Package`);
    if (!EXACT_VERSION.test(deps[name])) problems.push(`runtime dependency "${name}" is not pinned exactly: "${deps[name]}"`);
  }
  for (const name of newDev) {
    if (!APPROVED_DEV.has(name)) problems.push(`dev dependency "${name}" is not an approved dev-only addition`);
    if (!EXACT_VERSION.test(devDeps[name])) problems.push(`dev dependency "${name}" is not pinned exactly: "${devDeps[name]}"`);
  }
  for (const name of [...Object.keys(deps), ...Object.keys(devDeps)]) {
    if (BANNED_PACKAGE.some((re) => re.test(name))) problems.push(`banned package "${name}" is installed`);
  }
  if (!('@astrojs/react' in deps)) problems.push('@astrojs/react is not a dependency');
  if (!/@astrojs\/react/.test(read('astro.config.mjs'))) problems.push('astro.config.mjs does not use @astrojs/react');
  notes.push(`new runtime: ${newRuntime.map((n) => `${n}@${deps[n]}`).join(', ') || '(none)'}`);
  notes.push(`new dev-only: ${newDev.map((n) => `${n}@${devDeps[n]}`).join(', ') || '(none)'}`);
  record('Packages: Approved_Packages only, exact versions, no Tailwind / framer-motion', problems, { notes });
}

// ---------------------------------------------------------------------------
// 3. No ambient 'three' module declaration
// ---------------------------------------------------------------------------

{
  const problems = [];
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/declare\s+module\s+['"]three(?:\/[^'"]*)?['"]/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(`${file}:${line}: ${m[0]}`);
    }
  }
  record("No `declare module 'three'` in src/ (@types/three is approved)", problems);
}

// ---------------------------------------------------------------------------
// 4. Protected_Area unchanged since the phase base (R2.3)
// ---------------------------------------------------------------------------

{
  const problems = [];
  const notes = [];
  let skipped = false;
  if (!baseResolvable) {
    const msg = `phase base commit ${BASE_COMMIT ?? '(missing)'} is not available in this checkout`;
    if (process.env.CI) problems.push(`${msg} (CI must fetch full history: actions/checkout fetch-depth: 0)`);
    else {
      skipped = true;
      notes.push(`SKIPPED: ${msg}`);
    }
  } else {
    const changed = git(['diff', '--name-only', BASE_COMMIT]);
    const untracked = git(['ls-files', '--others', '--exclude-standard']);
    if (changed === null || untracked === null) problems.push('git diff failed');
    else {
      const files = [...changed.split('\n'), ...untracked.split('\n')].map((f) => normalisePath(f.trim())).filter(Boolean);
      const protectedFiles = files.filter((f) => /^(?:api|server|db)\//.test(f) || /(?:^|\/)\.env(?:\.|$)/.test(f));
      for (const f of protectedFiles) problems.push(`Protected_Area file changed since ${BASE_COMMIT.slice(0, 7)}: ${f}`);
      notes.push(`diff against ${BASE_COMMIT.slice(0, 7)}: ${files.length} changed or new path(s), ${protectedFiles.length} in api/ server/ db/ .env*`);
    }
  }
  record('Protected_Area (api/, server/, db/, .env*) unchanged since the phase base', problems, { notes, skipped });
}

// ---------------------------------------------------------------------------
// 5. Reference files untouched (R2.4)
// ---------------------------------------------------------------------------

{
  const problems = [];
  const notes = [];
  if (hashesFile === null) {
    problems.push(`${path.relative(ROOT, HASHES_FILE)} is missing`);
  } else if (!existsSync(abs('refrence'))) {
    // refrence/ is git-ignored (local-only), so a fresh clone or CI checkout does not have it.
    if (process.env.CI) notes.push('SKIPPED: refrence/ is git-ignored and absent from this checkout');
    else problems.push('refrence/ folder is missing');
  } else {
    let ok = 0;
    for (const [file, expected] of Object.entries(hashesFile.files)) {
      if (!exists(file)) {
        problems.push(`${file}: deleted (recorded in reference-hashes.json)`);
        continue;
      }
      const actual = createHash('sha256').update(readFileSync(abs(file))).digest('hex');
      if (actual !== expected) problems.push(`${file}: content changed (SHA-256 differs)`);
      else ok += 1;
    }
    const recorded = new Set(Object.keys(hashesFile.files));
    const current = walkAll('refrence');
    for (const f of current) if (!recorded.has(f)) notes.push(`new, not hashed: ${f}`);
    notes.unshift(`${ok} of ${recorded.size} recorded files match`);
  }
  record('Reference files unchanged (SHA-256 of refrence/)', problems, { notes });
}

// ---------------------------------------------------------------------------
// 5a. Contact_Replacement under 2 MB (R14.3, R14.5)
// ---------------------------------------------------------------------------
// Task 4.2. The Contact_Page (Phase 4) is built from the Contact_Replacement: a new,
// legible export the user places in refrence/ (glossary + R14). R14.3/R14.5 cap it at
// under 2 MB; legibility stays a human decision recorded in the Phase_Summary, so it is
// NOT checked here.
//
// The check is CONDITIONAL on a confirmed replacement path. Task 4.1 confirms the file and
// records its repo-relative path below; until then CONTACT_REPLACEMENT_PATH is null and this
// check is a no-op (it passes without touching the filesystem). It must never run against the
// old refrence/contact_page.png (131 KB), which is the Contact_Reference, not the replacement.
//
// To arm the check once a legible replacement is confirmed in task 4.1, set this to its
// repo-relative path, e.g. 'refrence/contact_page.png' or whatever export the user supplies.
/** @type {string | null} */
const CONTACT_REPLACEMENT_PATH = null;
const CONTACT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB (R14.3): fail at this size or larger.

{
  const problems = [];
  const notes = [];
  if (CONTACT_REPLACEMENT_PATH === null) {
    notes.push('SKIPPED: no Contact_Replacement path recorded yet (set in task 4.1); legibility is a human decision in the Phase_Summary');
  } else if (!exists(CONTACT_REPLACEMENT_PATH)) {
    problems.push(`${CONTACT_REPLACEMENT_PATH}: recorded Contact_Replacement is missing`);
  } else {
    const bytes = statSync(abs(CONTACT_REPLACEMENT_PATH)).size;
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    if (bytes >= CONTACT_MAX_BYTES) problems.push(`${CONTACT_REPLACEMENT_PATH}: ${mb} MB is 2 MB or more; supply a smaller export (R14.5)`);
    else notes.push(`${CONTACT_REPLACEMENT_PATH}: ${mb} MB (under 2 MB)`);
  }
  record('Contact_Replacement under 2 MB (legibility is a human decision)', problems, { notes });
}

/** All files under a directory, repo-relative (no skip list). @param {string} rel */
function walkAll(rel) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function visit(dir) {
    for (const entry of readdirSync(abs(dir), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) out.push(child);
    }
  }
  visit(rel);
  return out.sort();
}

// ---------------------------------------------------------------------------
// 6. Ignored references (R1.4, R3.4)
// ---------------------------------------------------------------------------

{
  // Built at run time so this file does not match itself.
  const needle = `${'DESIGN'} (`;
  const problems = [];
  const files = ['src', 'scripts', 'tests'].flatMap((dir) => (exists(dir) ? walkAll(dir) : []));
  for (const file of files) {
    if (!/\.(?:astro|ts|tsx|js|mjs|cjs|json|css|md|txt|html)$/i.test(file)) continue;
    const text = read(file);
    const at = text.indexOf(needle);
    if (at !== -1) problems.push(`${file}:${text.slice(0, at).split('\n').length}: mentions the ignored DESIGN reference files`);
  }
  record('No mention of the ignored numbered design reference files in src/, scripts/, tests/', problems);
}

// ---------------------------------------------------------------------------
// 7. Router and vendored script (phase dependent)
// ---------------------------------------------------------------------------

{
  const problems = [];
  const uses = [];
  for (const { file, text } of sources) {
    const kind = kindOfFile(file);
    // Comments may talk about the router (the lifecycle gate does); only code and markup count.
    const code = kind === null ? text : withoutComments(text, kind);
    for (const m of code.matchAll(/\bClientRouter\b|astro:transitions/g)) {
      uses.push({ file, line: code.slice(0, m.index).split('\n').length, match: m[0] });
    }
  }
  if (PHASE <= 2) {
    for (const u of uses) problems.push(`${u.file}:${u.line}: ${u.match} (ClientRouter is not allowed before Phase 3)`);
  } else {
    const inLayout = uses.filter((u) => u.file === 'src/layouts/BaseLayout.astro' && u.match === 'ClientRouter');
    if (inLayout.length === 0) problems.push('ClientRouter is missing from src/layouts/BaseLayout.astro (required from Phase 3)');
    for (const u of uses) if (u.file !== 'src/layouts/BaseLayout.astro') problems.push(`${u.file}:${u.line}: ${u.match} (only BaseLayout.astro may use the router)`);
  }
  record(PHASE <= 2 ? 'Router absent (Phase 1 and 2)' : 'Router only in BaseLayout.astro (Phase 3+)', problems);
}

// ---------------------------------------------------------------------------
// 7a. No `astro:page-load` listener anywhere in src/ (the lifecycle gate must never bind it)
// ---------------------------------------------------------------------------
// `astro:page-load` also fires on the first load under the router, which would duplicate the
// initial enter and break the gate's balance. The gate binds `astro:after-swap` instead. This
// rule is phase-independent: binding `astro:page-load` is wrong in every phase.

{
  const problems = [];
  for (const { file, text } of sources) {
    const kind = kindOfFile(file);
    const code = kind === null ? text : withoutComments(text, kind);
    for (const m of code.matchAll(/addEventListener\s*\(\s*(['"`])astro:page-load\1/g)) {
      problems.push(`${file}:${code.slice(0, m.index).split('\n').length}: binds astro:page-load (the gate must not; use astro:after-swap)`);
    }
  }
  record("No `astro:page-load` listener in src/ (the lifecycle gate never binds it)", problems);
}

if (PHASE >= 2) {
  record('Vendored particles script removed (Phase 2+)', exists('public/vendor/particles.min.js') ? ['public/vendor/particles.min.js still exists'] : []);
}

// ---------------------------------------------------------------------------
// 7b. Phase 2 rules: Card has no shadow, only the `filled` button variant is filled (Open_Decisions 1 and 2)
// ---------------------------------------------------------------------------

if (PHASE >= 2) {
  record('Card: no box-shadow and no --card-shadow-* in Card.astro (Open_Decision 1)', checkCardRule(sources));
  record('Buttons: a solid fill only under the `filled` variant of Button.astro (Open_Decision 2)', checkButtonRule(sources, readTokenValues(read(TOKENS_PATH))));
  const filled = checkFilledCount(sources, PHASE);
  record(
    PHASE <= 2 ? 'Filled CTA: variant="filled" appears 0 times in src/ (wired in Phase 3)' : 'Filled CTA: variant="filled" appears exactly once, in src/pages/index.astro',
    filled.problems,
    { notes: [`variant="filled" usages outside Button.astro: ${filled.uses.map((u) => `${u.file}:${u.line}`).join(', ') || '(none)'}`] },
  );
}

// ---------------------------------------------------------------------------
// 8. Fonts (Open_Decision 3, resolved): Inter Tight, self-hosted
// ---------------------------------------------------------------------------

{
  const problems = [];
  const notes = [];
  const fontsCss = exists('src/styles/fonts.css') ? read('src/styles/fonts.css').replace(/\/\*[\s\S]*?\*\//g, '') : null;
  if (fontsCss === null) {
    problems.push('src/styles/fonts.css is missing');
  } else {
    const families = new Set();
    for (const block of fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const family = /font-family\s*:\s*([^;]+);/.exec(block[1]);
      if (!family) continue;
      const name = family[1].trim().replace(/^['"]|['"]$/g, '');
      families.add(name);
      for (const u of block[1].matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        const url = u[2].trim();
        if (!url.startsWith('/') || url.startsWith('//')) {
          problems.push(`fonts.css: ${name}: url(${url}) is not root-relative`);
        } else if (!exists(`public${url.replace(/[?#].*$/, '')}`)) {
          problems.push(`fonts.css: ${name}: public${url} does not exist`);
        }
      }
    }
    if (!families.has('Inter Tight')) problems.push('fonts.css does not declare "Inter Tight"');
    if (!families.has('Inter Tight Fallback')) problems.push('fonts.css does not declare "Inter Tight Fallback"');
    for (const f of families) {
      if (f !== 'Inter Tight' && f !== 'Inter Tight Fallback') {
        problems.push(`fonts.css declares "${f}" (only Inter Tight and Inter Tight Fallback are allowed; old families are removed since task 1.6)`);
      }
    }
    notes.push(`fonts.css families: ${[...families].join(', ')}`);
  }
  const tokens = readTokenValues(read(TOKENS_PATH));
  for (const name of ['--font-display', '--font-body', '--font-mono']) {
    const value = tokens.get(name);
    if (value === undefined) problems.push(`${name} is not defined in tokens.css`);
    else if (!/^['"]Inter Tight['"]/.test(value)) problems.push(`${name} does not begin with 'Inter Tight': ${value.slice(0, 40)}`);
  }
  if (!exists('src/layouts/BaseLayout.astro')) {
    problems.push('src/layouts/BaseLayout.astro is missing');
  } else {
    const markup = getRegions(read('src/layouts/BaseLayout.astro'), 'astro').markup ?? '';
    const preloaded = iterTags(markup).filter((tag) => {
      if (tag.name !== 'link') return false;
      const rel = tag.attrs.find((a) => a.name === 'rel');
      const as = tag.attrs.find((a) => a.name === 'as');
      return rel !== undefined && /\bpreload\b/i.test(rel.value) && as !== undefined && as.value === 'font';
    });
    const hrefs = preloaded.map((tag) => tag.attrs.find((a) => a.name === 'href')?.value ?? '');
    if (!hrefs.some((h) => /^\/fonts\/inter-tight-[\w-]+\.woff2$/.test(h))) problems.push('BaseLayout.astro does not preload an /fonts/inter-tight-*.woff2 file');
    for (const h of hrefs) if (!exists(`public${h}`)) problems.push(`BaseLayout.astro preloads ${h} but public${h} does not exist`);
    notes.push(`preloads: ${hrefs.join(', ') || '(none)'}`);
  }
  notes.push('external font URLs are covered by the font-source rule in the source scan');
  record('Fonts: Inter Tight self-hosted, tokens and preload (Open_Decision 3)', problems, { notes });
}

// ---------------------------------------------------------------------------
// 9. Contrast of the declared token pairs (R4.6, R9.4)
// ---------------------------------------------------------------------------

{
  const problems = [];
  const notes = [];
  if (!existsSync(PAIRS_FILE)) {
    problems.push('scripts/contrast-pairs.json is missing');
  } else {
    const pairs = JSON.parse(readFileSync(PAIRS_FILE, 'utf8')).pairs;
    const results = checkContrastPairs(read(TOKENS_PATH), pairs);
    for (const r of results) {
      const shown = r.ratio === null ? 'unresolvable' : `${r.ratio.toFixed(2)}:1`;
      notes.push(`${r.ok ? 'ok  ' : 'FAIL'}  ${shown.padStart(8)}  (min ${r.min})  ${r.label}: ${r.fg} on ${r.bg}`);
      if (!r.ok) problems.push(`${r.label}: ${r.fg} on ${r.bg} is ${shown}, needs ${r.min}${r.error ? ` (${r.error})` : ''}`);
    }
  }
  record('Contrast of declared token pairs (text >= 4.5, focus ring >= 3)', problems, { notes });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

let failed = 0;
for (const check of checks) {
  const status = check.problems.length > 0 ? 'FAIL' : check.skipped ? 'SKIP' : 'PASS';
  if (status === 'FAIL') failed += 1;
  console.log(`${status}  ${check.name}`);
  for (const note of check.notes) console.log(`        ${note}`);
  for (const problem of check.problems) console.log(`      - ${problem}`);
}
console.log('');
console.log(
  failed === 0
    ? `verify-source: all ${checks.length} checks passed (phase ${PHASE}${STRICT ? ', strict' : ''})`
    : `verify-source: ${failed} of ${checks.length} checks failed (phase ${PHASE}${STRICT ? ', strict' : ''})`,
);
process.exit(failed === 0 ? 0 : 1);
