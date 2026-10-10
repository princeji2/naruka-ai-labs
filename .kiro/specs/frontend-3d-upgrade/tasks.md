# Implementation Plan: Frontend 3D Upgrade

## Overview

Implementation language: **TypeScript** (strict, no `any`, no `@ts-*` directives) for `src/lib/**` and the React islands; **Astro** for every component and page; **Node ESM `.mjs`** for `scripts/` and `tests/logic/` (built-in `node --test`, no new test dependency).

The work follows the five phases in `requirements.md`. **Every phase ends with a checkpoint task that produces a Phase_Summary (files changed, what was adapted, what could not be done) and then STOPS until the user replies "go".** No task of the next phase may start before that "go" (Requirement 1.2, 1.3).

Rules that apply to every task:

- Do not touch the Protected_Area (`api/`, `server/`, `db/`, `.env*`), anything under `refrence/`, routes, copy, branding or data (Req 2).
- Colours come only from Design_Tokens (`src/styles/tokens.css`). Colour tokens are not edited unless Req 4.5 applies. There are exactly two documented non-colour exceptions, both in Phase 1: the `--font-display/--font-body/--font-mono` stacks (task 1.5) and the Display_Tokens (task 1.7) (Req 4.7). Reference files are copied first and adapted minimally; every adaptation goes into the Phase_Summary (Req 3.5, 3.6).
- Anything that cannot be done is recorded under "what could not be done" with the reason (Req 1.6).
- `DESIGN (2).md` to `DESIGN (6).md` are never read or used (Req 3.4).
- Do not start dev servers or watchers from a task. If a running preview server is needed, ask the user to run `npm run preview` and give the exact command.
- Optional sub-tasks (marked `*`) are test-related. The verification scripts (`verify-source`, `verify-dist`, scanner libraries, baseline files, CI wiring) are required, and they are not marked optional.

## Tasks

- [x] 1. Phase 1: Foundation (dependencies, Astro React integration, Lenis and ScrollTrigger with cleanup, Inter Tight font, display type tokens)
  - [x] 1.1 `@types/three` approval (resolved: approved, 2026-10-10)
    - **Resolved by the user on 2026-10-10: yes, `@types/three` is approved as a dev dependency.** No question is asked and no `declare module 'three'` ambient fallback (`src/types/three.d.ts`) is created.
    - Task 1.4 installs it. Record the decision (approved, 2026-10-10) and the installed version in the Phase 1 Phase_Summary.
    - _Requirements: 5.8, 5.10, 9.6, 9.7, 16.1_

  - [x] 1.2 Record the phase base and the reference hashes
    - Record the current git commit hash as the Phase 1 base (used later by the Protected_Area diff check).
    - Write `.kiro/specs/frontend-3d-upgrade/reference-hashes.json` with the SHA-256 of every file under `refrence/` (the folder is git-ignored, so `git diff` cannot prove it is untouched; finding F12).
    - Do not modify any file in `refrence/`.
    - Hashing reads file bytes only. The content of `DESIGN (2).md` to `DESIGN (6).md` is never opened, parsed or used for design; they are hashed solely to prove they are unmodified (Req 2.4, 3.4).
    - _Requirements: 2.4, 1.4_

  - [x] 1.3 Capture the pre-upgrade baseline snapshot
    - Create `scripts/lib/scan-dist.mjs` with the pure functions used by both the baseline capture and `verify-dist`: visible-text extraction (strip `script`, `style`, `[aria-hidden="true"]`, `<svg>`), `href` set extraction, route list from `dist/**/index.html`, and the external-script scanner (`scanExternalScripts`, covering `<script src>`, `<link rel="modulepreload">`, `import("https://…")`, protocol-relative URLs, any attribute order and quote style, while ignoring `<a href>`).
    - Run `npm run build` on the **unmodified** site (before dependency installation) and write `scripts/baseline/routes-and-text.json` with the route list, visible text per route and `href` set per route.
    - _Requirements: 2.1, 2.2, 10.4, 9.9_

  - [x] 1.4 Install the Approved_Packages with exact versions
    - Re-run `npm view` for each package and pin whatever is current (design date reference: `gsap 3.15.0`, `lenis 1.3.26`, `three 0.186.1`, `@react-three/fiber 9.8.1`, `@react-three/drei 10.7.9`, `@astrojs/react 7.0.1`, `react`/`react-dom 19.3.0`). Confirm the `react` version satisfies the `@react-three/fiber` peer range.
    - `npm install --save-exact` for runtime: `gsap`, `lenis`, `three`, `@react-three/fiber`, `@react-three/drei`, `@astrojs/react`, `react`, `react-dom`.
    - `npm install --save-exact --save-dev` for `@types/react`, `@types/react-dom`, and `@types/three` (approved in 1.1; design date `0.186.0`, pick the version that matches the installed `three`).
    - The font package is installed in task 1.5, not here.
    - Verify no range operators (`^`, `~`) appear on the new entries and that Tailwind, framer-motion, shadcn/ui and Radix are absent.
    - Do not add `ClientRouter` or any `astro:transitions` import in this phase (Req 10.6).
    - Keep the list of every installed package and version for the Phase_Summary.
    - _Requirements: 5.1, 5.2, 5.6, 5.7, 5.9, 5.10, 10.1, 10.2, 10.6, 1.5_

  - [x] 1.5 Install and self-host Inter Tight, and switch all text to it
    - **Order of work (so a failure leaves the current fonts working):** (a) install and verify, (b) copy and prove the file serves, (c) only then edit `fonts.css`, `tokens.css` and `BaseLayout.astro`. If any step fails (package will not install, file will not serve from `'self'`, build fails), revert any edit already made, keep the current fonts, and report it to the user in the Phase_Summary. Do not use a CDN (design section 13, Req 16.7).
    - `npm view @fontsource-variable/inter-tight version` and `npm install --save-exact @fontsource-variable/inter-tight` (design date `5.3.0`; the static `@fontsource/inter-tight` is the fallback choice if the variable file cannot be used). Check there is no range operator on the entry.
    - Search `src/` for `<em`, `<i `, `font-style: italic`. Copy `node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2` into `public/fonts/`, plus `inter-tight-latin-wght-italic.woff2` only if italics are used, plus the package's licence file (OFL) next to them. Do not modify the copied font bytes.
    - Search for code usage: `<code`, `<pre`, `var(--font-mono)`; record the result for the Phase_Summary (how much text is affected by the monospace change).
    - `src/styles/fonts.css`: add one `Inter Tight` variable face (keep the old Inter, Plus Jakarta Sans and JetBrains Mono `@font-face` blocks in place for now; task 1.6 removes them only if nothing else references them). The Inter Tight face is (`font-weight: 100 900`, `font-display: swap`, root-relative `src`, the latin `unicode-range` taken from the package's own latin CSS) and a size-adjusted `Inter Tight Fallback` face (`src: local('Arial')` with `size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`). Derive the numbers from the font's own metrics (`head`, `hhea`, `OS/2`) with a throwaway Node script that uses built-ins only (`zlib` Brotli over the woff2 table stream); delete the script afterwards, and record the numbers. If the metrics cannot be derived reliably, ship without the overrides and say so (note: the current file has no size-adjusted fallback, finding F17, so this is new work).
    - `src/styles/tokens.css` (documented non-colour exception, Req 4.7): set `--font-display`, `--font-body` and `--font-mono` to `'Inter Tight', 'Inter Tight Fallback', <the existing generic tail>`. Change nothing else in this task.
    - `src/layouts/BaseLayout.astro`: replace the two font preloads (`inter-400.woff2`, `plus-jakarta-sans-700.woff2`) with one preload of `/fonts/inter-tight-latin-wght-normal.woff2`, keeping the existing `as="font" type="font/woff2" crossorigin` pattern. Edit only the preload block here (the layout is edited again in 1.13).
    - Confirm CSP: `vercel.json` is not modified (`font-src 'self'` already covers `/fonts/*`).
    - Run `npm run check` and `npm run build`. Confirm every route's visible text and links still equal the baseline from 1.3 (only the typeface changes).
    - Record for the Phase_Summary: package and exact version, files added, the metrics numbers, the code-usage finding, and the question **"Should JetBrains Mono come back for code text?"** (Inter Tight is applied to code by default because the user said all text; do not apply JetBrains Mono meanwhile).
    - _Requirements: 5.1, 5.2, 9.9, 10.5, 10.7, 4.7, 16.4, 16.5, 16.7, 16.8_

  - [x] 1.6 Remove the old fonts only if nothing references them
    - After 1.5, search `src/`, `public/`, `vercel.json`, `astro.config.mjs`, `scripts/` and `.github/` for `Inter'`, `Plus Jakarta`, `JetBrains`, `inter-400`, `inter-500`, `inter-600`, `plus-jakarta`, `jetbrains-mono` (ignore the substring "Inter" inside words such as "Interoperability"; the Setu SVG's `font-family="var(--font-display)"` is a token reference and is not a font-name reference).
    - If every remaining match is one of the declarations or files being removed: delete the 8 old woff2 files in `public/fonts/` and confirm `fonts.css` no longer names them. Otherwise leave the declarations and files in place, and list each remaining reference (file and line) in the Phase_Summary. `README.md` and `refrence/` mentions are documentation: report, do not edit.
    - Run `npm run build` and confirm `dist/` has no reference to a deleted file.
    - _Requirements: 16.6, 10.7_

  - [x] 1.7 Add the display type tokens and amend the old font-size check
    - `src/styles/tokens.css` (documented non-colour exception, Req 4.7 and 16.9; edit after 1.5): add at most 3 sets, each with a matching line-height and letter-spacing token: `--font-size-display-1` (hero headline, fluid, about 44 px to 144 px, line-height 0.95, letter-spacing -0.03em), `--font-size-display-2` (page and large section headlines, about 36 px to 101 px, line-height 1.0, letter-spacing -0.02em), `--font-size-display-3` (section headlines, about 28 px to 66 px, line-height 1.1, letter-spacing -0.011em). Names: `--line-height-display-1..3`, `--letter-spacing-display-1..3`. These are the design defaults from the GSAP_Spec type scale (design section 14); tune them against the real headings at 360 and 1440 px, keep each size at 12 px or more, and record the final values in the Phase_Summary (the GSAP_Spec shows 224 px, the cap is lower because the Naruka copy is longer; report this as an adaptation). Do not change any existing token value and do not use the new tokens in any page yet.
    - **Find and amend the old check.** Searching `scripts/`, `.github/`, `.githooks/`, `tests/`, `src/` and `package.json` for a distinct-font-size count finds nothing, so no script, test or CI step enforces it (re-run the search to confirm, e.g. `Select-String -Pattern 'distinct|font-size'`). The check exists in the old spec's documents. Amend, with a dated note "amended by frontend-3d-upgrade, 2026-10-10" and without changing any task status:
      - `.kiro/specs/usability-consistency-fixes/requirements.md`: criterion 1.2 and the Distinct_Font_Size glossary entry now count Body_Font_Sizes only (display tokens `--font-size-display-1..3` excluded), and a new sentence allows at most 3 display tokens.
      - `.kiro/specs/usability-consistency-fixes/design.md`: Property 2 (statement and the counting snippet around lines 411 to 432, which must also match `display-[0-9]` names and report the two groups separately; the old regex `var\(--font-size-([0-9a-z]+)\)` would silently skip them).
      - `.kiro/specs/usability-consistency-fixes/tasks.md`: task 1.6 text, with the same split.
    - The enforcing check is added in task 1.15 (`font-size-budget`) so the limit is a CI check from now on.
    - Run `npm run check` and `npm run build`. Run the amended old snippet by hand (PowerShell) and confirm it still reports at most 10 body sizes and zero display tokens in use.
    - _Requirements: 4.7, 10.8, 16.9, 16.10_

  - [x] 1.8 Wire the React integration, TypeScript options and npm scripts
    - `astro.config.mjs`: add the `@astrojs/react` integration (`react()`).
    - `tsconfig.json`: set `jsx: "react-jsx"`, `jsxImportSource: "react"`, `erasableSyntaxOnly: true`. Keep strict mode.
    - `package.json` scripts: `test:logic` (`node --test "tests/logic/**/*.test.mjs"`), `verify:source`, `verify:dist`, `verify` (source then dist).
    - `erasableSyntaxOnly` needs TypeScript 5.8 or newer: `package.json` declares `^5.7.3`, so confirm the installed version with `npm ls typescript` (design date: 5.9.3) and pin `typescript` to an exact version at 5.8+ if the lockfile would resolve lower.
    - Run `npm run check` and confirm zero errors.
    - _Requirements: 5.3, 5.5, 9.6, 9.7, 10.4_

  - [x] 1.9 Implement the token bridge
    - `src/lib/theme/color.ts`: `Rgb`, `Rgba`, `parseCssColor` (rgb/rgba comma and space syntax, `color(srgb …)`, `null` otherwise), `formatRgb`.
    - `src/lib/theme/token-file.ts`: `readTokenDeclaration(css, name)`; returns the first `name: value;` in `:root`, ignores comments, throws if the token is missing or the value contains `var(` or `color-mix(`.
    - `src/lib/theme/tokens.ts`: `createTokenReader(doc)` using a probe element and the used `color`, with a cache, `invalidate()`, and a named error for missing tokens. No colour literal in any of these files.
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 1.10 Implement the page lifecycle gate
    - `src/lib/lifecycle/page-lifecycle.ts`: `createGate`, `bindPageLifecycle` (DOMContentLoaded or immediate enter, `pagehide` leave, `pageshow` with `persisted` enter, `astro:before-swap` leave, `astro:after-swap` enter, returns an unbind function that removes every listener it added). Exactly as in the design, section 1.
    - **`astro:page-load` is NOT bound** (it also fires on the first load under a router, which would duplicate the initial enter). The gate must stay idempotent for any interleaving of these events.
    - Phase 1 does not add `ClientRouter`; the router events are simply inert until Phase 3. Do not import `astro:transitions` anywhere.
    - _Requirements: 6.5, 6.7, 10.6_

  - [x] 1.11 Implement the Scroll_Controller
    - `src/lib/scroll/scroll-controller.ts`: dependency-injected core (`createScrollController`) with `init`, `destroy`, `register`, `lock`, `running`, `stats`. Lenis lives in its own `fullMotion` matchMedia context (no Lenis under reduced motion); a Lenis creation failure is caught and leaves native scrolling with effects still registered; `destroy` kills the matchMedia, then kills any remaining triggers; ref-counted `lock()` stops Lenis iff at least one lock is held; `document.fonts.ready` then `refresh()` guarded by an init generation.
    - `src/lib/scroll/index.ts`: real wiring (`gsap`, `ScrollTrigger`, `CustomEase`, `Lenis` with `autoRaf: false`, `lerp: 0.1`, `anchors: false`, `syncTouch: false`, `import 'lenis/dist/lenis.css'`, plugins registered once). DEV-only `globalThis.__narukaMotionStats` behind `import.meta.env.DEV`.
    - No `console.*` outside DEV branches.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 7.4, 7.5, 10.3, 9.2_

  - [x] 1.12 Implement the motion layer and the page entry
    - `src/lib/motion/config.ts`: `MOTION_QUERIES`, `parseDurationToken`, `parseCubicBezier`, `readMotionTokens` (600 ms, `--ease-out`, 24 px, 0.08 s stagger, `top 88%`, constant 0.2 s reduced fade; design assumption A1, all numbers in this one file).
    - `src/lib/motion/guard.ts`: `findNonComposited` with the composited and control key sets.
    - `src/lib/motion/plan.ts`: pure `planReveal(flags, tokens)` returning `RevealPlan` (opacity and `y` only; reduced motion is opacity only with no stagger; no `scrub`, no `pin`).
    - `src/lib/motion/api.ts` (types and pure helpers only) and `real-api.ts` (GSAP/ScrollTrigger implementation routed through the guard; dev-time throw on a non-composited key).
    - `src/lib/motion/reveal.ts`: `revealRegistration(api, tokens)` using `REVEAL_SELECTOR` (`main :is(.section-heading, .glass-panel, .card), [data-reveal]`), `batch`, and `setMotionState`.
    - `src/lib/motion/index.ts`: register `reveal` on `scrollController`.
    - `src/lib/motion/entry.ts`: bind the lifecycle gate to `scrollController.init/destroy`.
    - _Requirements: 6.6, 6.8, 6.9, 6.10, 7.2, 7.3, 12.4_

  - [x] 1.13 Wire the foundation into `BaseLayout.astro` and `global.css`
    - `BaseLayout.astro`: inline `data-motion` gate script in `<head>` (pending, then failed after 2500 ms), a `<script>` importing `src/lib/motion/entry.ts`, and `theme-color` derived from `tokens.css?raw` through `readTokenDeclaration(…, '--bg')` (removes the last hex literal in the layout). Leave the Inter Tight preload from 1.5 as it is, and do not add `ClientRouter`.
    - `global.css`: remove the `animation-timeline: view()` reveal block (finding F4); add the `html[data-motion='pending']` hide rule for the reveal selector; change `.skip-link` from `transition: top` to a `transform`-based move; leave `scroll-behavior: smooth` (the Lenis CSS import overrides it while Lenis runs).
    - Confirm every route still renders as before: `npm run check`, `npm run build`, and compare against `scripts/baseline/routes-and-text.json`.
    - _Requirements: 10.3, 10.4, 4.2, 6.9, 9.1, 9.3, 2.1, 2.2_

  - [x] 1.14 Implement the source-scan rule libraries
    - `scripts/lib/scan-colours.mjs`: `scanColours(text, kind)` for hex, `rgb(`/`rgba(`/`hsl(`/`hsla(` with a numeric first argument (comma or space syntax) and named colours in colour positions; does not flag `transparent`, `currentColor`, `inherit`, `rgba(var(--x-rgb), a)`, hex in `href`/`id`/`for`/`url(#…)`/selectors, or comments; ignores `tokens.css`.
    - `scripts/lib/scan-motion.mjs`: `scanLayoutTween` (GSAP `to/from/fromTo/set/quickTo` and timeline calls; layout keys `width, height, top, left, right, bottom, inset, margin*, padding*`) and `scanLayoutTransition` (CSS and Astro `<style>`: layout properties, `all`, shorthand with no property list, and `@keyframes` referenced by `animation`).
    - `scripts/lib/scan-types.mjs`: `scanTypes` for `: any`, `as any`, `<any>`, `any[]`, `Array<any>`, `any` as a generic argument, and `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`; must ignore `company`, strings and prose comments.
    - `scripts/lib/scan-rules.mjs`: `console` outside `import.meta.env.DEV`, `network` (fetch/XHR/beacon/WebSocket/EventSource in `src/lib/**`, `src/components/scene/**`, `src/pages/signin/**`; storage in sign-in), `react-location`, `banned-import` (`framer-motion`, `tailwindcss`, `@radix-ui/*`, `shadcn*`; `three` and `@react-three/*` outside `src/components/scene/**`), `drei-remote` (Environment preset, Text/Text3D without a local font, remote URLs to `useGLTF/useTexture/useFont`), `cdn-literal`.
    - Also in `scan-rules.mjs`: `font-source` (external font URLs such as `fonts.googleapis`, `fonts.gstatic`, `@import url(http…)`, `src: url(http…)` in `src/` and `public/`; a `url(...)` in `fonts.css` that points to a missing file), `font-size-budget` (a `font-size` that is not a `var(--font-size-*)` token; a referenced token with no definition in `tokens.css`; more than 10 distinct Body_Font_Sizes with `base` and `md` counted once and each fluid token once; a Body_Font_Size under 12 px; more than 3 display tokens `--font-size-display-1..3`; display tokens are excluded from the cap of 10), and `unmanaged-listener` (in `<script>` blocks of `.astro` files and in `src/lib/**`, a top-level `document.addEventListener` or `window.addEventListener` that has no `{ signal }` option and is not inside a setup function bound through `bindPageLifecycle`; the gate's own lifecycle bindings are exempt).
    - `scripts/lib/contrast.mjs`: WCAG relative luminance and contrast ratio, symmetric, range 1 to 21, plus a `tokens.css` colour resolver for declared pairs.
    - _Requirements: 4.1, 4.2, 4.6, 5.4, 5.5, 5.6, 5.7, 6.8, 6.9, 8.2, 9.2, 9.6, 9.9, 13.5, 15.6, 16.4, 16.9, 16.10, 12.9_

  - [x] 1.15 Implement `scripts/verify-source.mjs` and the burn-down baseline
    - Walk `src/**` (`.astro`, `.ts`, `.tsx`, `.css`), `public/**/*.js`, `astro.config.mjs`; exclude `tokens.css` (colour rule only), `node_modules`, `dist`, `refrence`, `scripts`, `tests`. Apply all rules from 1.14 and print `rule  file:line`.
    - `scripts/verify-baseline.json`: record known violations as `{ rule, file, count }` (Background hex literals, `public/vendor/particles.min.js` colour literals, `console` calls and URL string (removed with the file in 2.3), sign-in layout transitions (`transition: all`, and shorthands with no property list), `HeroPrism` console, Contact clipboard `console.warn` (fixed in 4.8), and the `unmanaged-listener` hits in Navbar, Card, Contact, HeroPrism and any other existing script (removed by the Phase 3 audit, task 3.17). `BaseLayout` is fixed in 1.13, so it gets no entry). Generate the list by running the scanners over the real tree, not from memory. Fail if a count rises or if a count falls below its entry ("baseline is stale"). `--strict` ignores the file.
    - Smoke checks: new runtime deps are a subset of the Approved_Packages (which now include the Inter Tight font package) plus `react`/`react-dom`, exact versions only (dev-only additions `@types/react`, `@types/react-dom`, `@types/three` are listed in the report), `@astrojs/react` present in `astro.config.mjs`, no `tailwindcss`/`framer-motion`; no `declare module 'three'` anywhere in `src/`; Protected_Area diff against the Phase 1 base commit from 1.2; every file recorded in `reference-hashes.json` still exists with the same SHA-256 (a modified or deleted file fails; a file the user adds later, such as the new contact export, is reported as "new, not hashed" and does not fail); no mention of `DESIGN (` in `src/`, `scripts/`, `tests/` (build the needle at runtime, for example `'DESIGN' + ' ('`, so `verify-source.mjs` does not match itself); no `ClientRouter` or `astro:transitions` import in `src/` while the current phase is 1 or 2 (flipped to "exactly one, in `BaseLayout.astro`" by task 3.18).
    - **Resolved-decision checks that hold in Phase 1 (these replace the old "defaults" checks):**
      - **Fonts (Open_Decision 3, resolved):** `fonts.css` declares `Inter Tight` (and `Inter Tight Fallback`); every `src` file it names exists under `public/fonts/` and is root-relative; the `--font-display/--font-body/--font-mono` tokens begin with `'Inter Tight'`; `BaseLayout.astro` preloads the Inter Tight file; no external font URL (no CDN). The old Inter, JetBrains Mono and Plus Jakarta Sans declarations and files may remain only if the Phase 1 summary reports the reference that keeps them (task 1.6). If task 1.5 failed and the current fonts were kept, switch this check to the current-fonts variant and say so in the Phase_Summary.
      - **Display tokens:** `font-size-budget` passes.
      - **Buttons (Open_Decision 2, resolved):** the old check "`Button.astro` still defines a filled `primary`" is NOT added. The new rule (no filled non-hero button) is added in task 2.9.
      - **Cards (Open_Decision 1, resolved):** the check "`Card.astro` has no `box-shadow`" is added in task 2.9, because Card keeps its current shadows (including an `inset` highlight) until Phase 2.
    - `scripts/contrast-pairs.json` with the declared body-text and focus-ring token pairs; `verify-source` reports each ratio (text at least 4.5, focus ring at least 3) from the real `tokens.css`. Any pair that fails is reported, not silently adjusted (Req 4.5 governs token changes).
    - _Requirements: 2.3, 2.4, 1.4, 3.4, 4.1, 4.2, 4.6, 5.1, 5.2, 5.3, 5.6, 5.7, 5.10, 6.8, 6.9, 9.2, 9.4, 9.6, 10.6, 16.1, 16.4, 16.6, 16.9, 16.10_

  - [x] 1.16 Implement `scripts/verify-dist.mjs`
    - Run after `npm run build`, over `dist/**/index.html` and `dist/_astro/*`, using `scripts/lib/scan-dist.mjs`.
    - Checks: route set equals the baseline; visible text per route equals the baseline; `href` set per route equals the baseline; no external `<script src>` or `modulepreload`; `three` markers (`WebGLRenderer`, `__THREE__`) absent from the closure of **static** imports of every script referenced by the HTML, with a positive control (some chunk in `dist/_astro` contains the markers and is reachable only via dynamic `import()`); every `.scene` is `aria-hidden="true"` or `role="img"` with a non-empty `aria-label`, and every `<canvas>` is `aria-hidden` or inside such an element; every `.scene` has an `aspect-ratio` rule in the built CSS; `/signin/` has `noindex`, every `<form>` has `novalidate`, no other route links to `/signin`; the navbar menu button has `aria-expanded` and `aria-controls`; a gzip payload table of the eager JS closure per route (report only).
    - **Font checks:** every `<link rel="preload" as="font">` in the built HTML is root-relative and its file exists in `dist/`; the built CSS contains an `Inter Tight` `@font-face` whose `src` files exist in `dist/`; no external font URL in any built HTML or CSS file.
    - **Router marker check:** in Phase 1 and 2 no built page carries the view-transitions marker (the `ClientRouter` is not present); from Phase 3 (flipped in task 3.18) every built page carries it, and `/signin/` keeps `noindex`. Confirm the marker's exact form in the installed Astro version.
    - The scene, positive-control and reserved-space checks pass vacuously while no `.scene` exists (before Phase 3) and are made mandatory in Phase 3.
    - _Requirements: 2.1, 2.2, 8.1, 8.2, 9.1, 9.5, 9.9, 10.6, 11.6, 13.4, 15.8, 16.4_

  - [x] 1.17 Wire the checks into CI
    - `.github/workflows/ci.yml`: order secrets scan, `npm run check`, `npm run test:logic`, `npm run verify:source`, `npm run build`, `npm run verify:dist`.
    - Guard the `test:logic` step so it only runs when `tests/logic/**/*.test.mjs` exists (optional tests may be skipped), for example with an `if: hashFiles(...) != ''` condition.
    - Confirm the workflow Node version satisfies the type-stripping requirement (22.18 or newer, design assumption A4); pin it if not.
    - _Requirements: 9.7, 9.8, 15.6, 15.7_

  - [ ]* 1.18 Create the logic-test infrastructure
    - `src/lib/scene/prng.ts`: `mulberry32(seed)` (pure, deterministic; Phase 3 reuses this file).
    - `tests/logic/_pbt.mjs`: `forAll(arbitrary, property, { runs, seed, maxSize })` with at least 100 runs, `PBT_RUNS`/`PBT_SEED` env, size growth, replay line on failure.
    - `tests/logic/_fakes.mjs`: fakes for `gsap.matchMedia` (conditions, revert and re-run on flip, cleanups on `kill`), Lenis, ticker, ScrollTrigger, and the `MotionApi` recorder.
    - _Requirements: 6.1, 6.5, 6.7_

  - [ ]* 1.19 Write the property test for the page lifecycle gate
    - `tests/logic/gate.test.mjs`
    - **Property 1: Gate balance and idempotence**
    - Include examples: bfcache `pageshow(persisted)` re-enters; non-persisted does not; `astro:before-swap` leaves and `astro:after-swap` enters exactly once; `astro:page-load` is ignored (no duplicate entry); the unbind function removes every listener it added.
    - **Validates: Requirements 6.5, 6.7**

  - [ ]* 1.20 Write the property test for scroll controller invariants
    - `tests/logic/scroll-controller.test.mjs`
    - **Property 2: Scroll controller invariants under arbitrary sequences**
    - **Validates: Requirements 6.1, 6.2, 6.4, 6.5, 6.7, 7.4, 7.5**

  - [ ]* 1.21 Write the property test for trigger cleanup
    - `tests/logic/scroll-controller.test.mjs` (same file as 1.20, extend it)
    - **Property 3: Registered effects leave no triggers behind**
    - **Validates: Requirements 6.5, 6.6**

  - [ ]* 1.22 Write the property test for the scroll lock
    - `tests/logic/scroll-controller.test.mjs` (same file, extend it)
    - **Property 4: Scroll lock is reference counted**
    - **Validates: Requirements 6.1, 11.6**

  - [ ]* 1.23 Write example tests for controller wiring
    - `tests/logic/scroll-controller.test.mjs` (same file, extend it)
    - A Lenis `scroll` event calls `scrollTrigger.update` once; the ticker callback forwards `t * 1000` to `raf`.
    - _Requirements: 6.3, 6.4_

  - [ ]* 1.24 Write the property test for the composited-only guard
    - `tests/logic/guard.test.mjs`
    - **Property 5: The composited-only guard rejects exactly the non-composited keys**
    - **Validates: Requirements 6.8, 6.9**

  - [ ]* 1.25 Write the property test for reveal plans
    - `tests/logic/reveal-plan.test.mjs`
    - **Property 6: Reveal plans are composited-only and obey the motion mode**
    - **Validates: Requirements 6.8, 6.10, 7.2, 7.3, 12.4**

  - [ ]* 1.26 Write the property test for the motion token parsers
    - `tests/logic/motion-config.test.mjs`
    - **Property 10: Motion token parsers round trip**
    - **Validates: Requirements 6.10**

  - [ ]* 1.27 Write the property test for colour parsing
    - `tests/logic/color.test.mjs`
    - **Property 8: Colour format and parse round trip**
    - **Validates: Requirements 4.4**

  - [ ]* 1.28 Write the property test for the token declaration reader
    - `tests/logic/token-file.test.mjs`
    - **Property 9: Token declaration reader**
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 1.29 Write the property test for token contrast
    - `tests/logic/contrast.test.mjs`
    - **Property 11: Declared text and focus colour pairs meet contrast**
    - Uses the real `src/styles/tokens.css` and `scripts/contrast-pairs.json`.
    - **Validates: Requirements 4.6, 9.4**

  - [ ]* 1.30 Write the property test for the colour scanner
    - `tests/logic/scan-colours.test.mjs`
    - **Property 19: Colour scanner finds exactly the injected colour literals**
    - **Validates: Requirements 4.1, 4.2, 15.6**

  - [ ]* 1.31 Write the property test for the motion scanner
    - `tests/logic/scan-motion.test.mjs`
    - **Property 20: Motion scanner finds exactly the layout animations**
    - **Validates: Requirements 6.8, 6.9, 13.5, 15.6**

  - [ ]* 1.32 Write the property test for the type-safety scanner
    - `tests/logic/scan-types.test.mjs`
    - **Property 21: Type-safety scanner finds exactly the unsafe typings**
    - **Validates: Requirements 9.6, 15.6**

  - [ ]* 1.33 Write the property test for the external script scanner
    - `tests/logic/scan-dist.test.mjs`
    - **Property 22: External script scanner finds exactly the non-local script loads**
    - **Validates: Requirements 9.9**

  - [x] 1.34 Checkpoint: Phase 1 Phase_Summary and HARD STOP
    - Run `npm run check`, `npm run build`, `npm run test:logic` (if tests exist), `npm run verify:source`, `npm run verify:dist`. Fix failures before reporting.
    - Deliver the **Phase_Summary** with: files changed (created, modified, deleted); what was adapted from the Reference_Folder and why; what could not be done and why.
    - The summary MUST also contain:
      - the full list of installed packages with exact versions, runtime and dev, including the font package (Req 1.5, 5.9, 10.2);
      - the recorded decisions with dates: `@types/three` approved (2026-10-10), fonts (Inter Tight for all text, 2026-10-10), the display font-size tokens (2026-10-10), and the routing decision (`ClientRouter` deferred to Phase 3, 2026-10-10) (Req 16.11);
      - a statement that the Ignored_References (`DESIGN (2).md` to `DESIGN (6).md`) were not used (Req 1.4);
      - the **font outcome** (Req 10.5, 16.8): Inter Tight installed and self-hosted for all text, or the reason it could not be and that the current fonts were kept; the files, package version and size-adjusted fallback numbers; Mori and PPNeueMontreal replaced by Inter Tight; the old Inter, JetBrains Mono and Plus Jakarta Sans declarations and files removed or retained, with each remaining reference if retained; the code-text finding; and the question **"Should JetBrains Mono come back for code text?"** (not applied meanwhile);
      - the **non-colour token exceptions** made in `tokens.css` (the three font stacks and the display tokens, with final values) and the adaptation that the GSAP_Spec's 224 px display size was capped lower;
      - the **old spec check amendment**: where the 10-size limit was found (only in the `usability-consistency-fixes` documents, no script or CI step), which three documents were amended, and that `font-size-budget` now enforces the split cap in CI.
    - **STOP. Do not start Phase 2 until the user replies "go".**
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 5.9, 10.2, 10.4, 10.5, 10.9, 16.7, 16.8, 16.11_

- [x] 2. Phase 2: Shared components (navbar, footer, buttons, cards, background)
  - [x] 2.1 Implement the Background_Component logic modules
    - `src/lib/background/particle-field.ts`: `Particle`, `Bounds`, `BackgroundConfig`, `particleCountForArea`, `createParticles`, `step` (move, bounce, animate size and opacity), `push`. Config carried over from `refrence/background.txt` (density 140 per 800, size 1–3, opacity 0.3–0.7, speed 2, link distance 160, grab distance 220, push 4); `maxCount` 220 desktop, 60 Mobile_Viewport.
    - `src/lib/background/render.ts`: canvas-2D drawing of particles, links and hover grab lines using colours passed in from the token bridge (particles `--accent`, links and strokes `--secondary`).
    - `src/lib/background/quality.ts`: DPR cap 2 (1.5 on Mobile_Viewport), pointer features only for `(hover: hover) and (pointer: fine)`.
    - Typed, no `any`, no `@ts-ignore`, no colour literal.
    - _Requirements: 11.2, 11.3, 4.2, 4.4, 8.8_

  - [ ]* 2.2 Write the property test for the background simulation
    - `tests/logic/background-sim.test.mjs`
    - **Property 17: Background simulation stays bounded and capped**
    - **Validates: Requirements 8.8, 11.2**

  - [x] 2.3 Rewrite `Background.astro` and remove the vendored script
    - Render `<div class="site-background" aria-hidden="true"><canvas></canvas></div>` (fixed, `inset: 0`, `z-index: -3`, `pointer-events: none`) and a bundled `<script>` that starts the module through the lifecycle gate. One module-level `AbortController` owns `resize`, `pointermove`, `pointerdown`, `visibilitychange` and `matchMedia` listeners; the gate's leave (`pagehide`, and `astro:before-swap` once Phase 3 adds the router) aborts and cancels the animation frame; a `ResizeObserver` is disconnected on cleanup; enter builds everything fresh (so Phase 3 needs no change to this script's logic).
    - Dark-only mapping: drop the reference light set and the `MutationObserver`; gradient becomes `linear-gradient(to top right, var(--color-surface-deep), var(--bg), color-mix(in srgb, var(--secondary) 30%, var(--bg)))`; keep the existing `--background-scrim`.
    - Clicks on interactive elements do not push particles; paused while `document.hidden`; reduced motion draws one static frame.
    - Delete `public/vendor/particles.min.js` (and `public/vendor/` if empty). Remove the Background entries from `scripts/verify-baseline.json`.
    - Record in the Phase_Summary as adaptations: CDN/vendored script replaced, `@ts-ignore` removed, nine hex colours replaced by tokens (Req 11.4).
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 4.3, 9.5, 9.9, 7.1_

  - [x] 2.4 Restyle `Button.astro`: outlined pills everywhere, gradient-stroke primary, one filled hero CTA (Open_Decision 2, resolved 2026-10-10)
    - No question is asked: the decision is made (outlined pills everywhere, one filled CTA in the hero only).
    - `src/components/Button.astro`: all variants get `border-radius: var(--radius-full)`, a 1px border and weight 600. `secondary` is the outlined pill (transparent fill, `--text` border, hover raises border opacity with no fill). `ghost` stays text-only. Press feedback stays `:active { transform: scale(0.97) }`.
    - `primary` becomes the **Gradient_Stroke_Pill** (GSAP_Spec): transparent fill, `--text` text colour, a 1.5px gradient border from `--grad-studio-brand` drawn so the radius stays a clean pill (border-box mask or `background-clip` technique, no layout property animated), hover brightens the stroke through `opacity`/`filter`, never a fill. No colour literals.
    - Add a new `filled` variant carrying the old filled look with token colours; it is the only variant that may have a solid fill. `variant` only gains the value `filled`; all other props, link targets and text stay (Req 11.5).
    - **Convert every non-hero filled usage.** Re-run `Select-String -Pattern 'variant="primary"'` over `src/` and confirm each one now renders as the gradient-stroke pill (design-time list: `about` (1), `contact` (1), `field-book` (1), `setu` (2), `products` (2), `signin` (2 submit buttons), `404` (1), `index.astro` (2 outside the hero)). Switch the hero call site, the first `<Button>` in `src/pages/index.astro` (`size="lg"`, currently `variant="primary"`), to `variant="filled"` so the Hero_CTA stays the single filled button. The raw `<button>` on the contact page (line ~51) is not a `Button` usage: check its styles for a solid fill and, if it has one, report it for Phase 4 instead of editing the contact page now (Req 14.2). Edit no text or link in these files.
    - Confirm by search that `variant="filled"` appears exactly once in `src/` and that no `.astro` file outside `Button.astro` styles a solid button fill (`background: var(--primary)` or similar on a button or `.btn`-type class).
    - Record the resolution (outlined pills everywhere, 2026-10-10) and the converted call sites in the Phase_Summary.
    - _Requirements: 11.1, 11.5, 11.9, 11.10, 12.3, 16.3, 16.11_

  - [x] 2.5 Restyle `Card.astro` with no box-shadow and add card tilt (Open_Decision 1, resolved 2026-10-10)
    - No question is asked: cards have no `box-shadow`, and hover lift uses `transform` only.
    - `src/components/ui/Card.astro`: delete every `box-shadow` declaration (`var(--shadow-card)`, `inset 0 1px 0 rgba(var(--white-rgb), 0.1)` and `var(--shadow-card-lift)` on rest, hover and focus). The inset highlight is a box-shadow too, so replace it with a border colour step. Drop the `box-shadow` entry from `transition`. Do not introduce `--card-shadow-*` custom properties (the earlier switch design is dropped). Hover lift stays `translateY(-6px) scale(1.02)` through `transform`. Reduced motion keeps its no-transform rule. `.card[data-tilt]` disables the CSS hover transform. `will-change: transform` only while hovered. The `--shadow-card*` tokens stay in `tokens.css` untouched.
    - `src/lib/motion/card-tilt.ts`: registration for `fullMotion && finePointer && desktop`; `quickTo` on `rotationX`/`rotationY` (max ±5°, `transformPerspective: 900`); sets `data-tilt` while active; on leave tweens back and `clearProps: 'transform'`; cleanup removes listeners and attributes. Move the existing document-level `--mx/--my` `pointermove` listener into this registration so it is removed on cleanup.
    - Record the resolution (no card shadow, 2026-10-10) in the Phase_Summary.
    - _Requirements: 11.1, 11.5, 11.8, 16.2, 16.11, 6.8, 7.3_

  - [x] 2.6 Restyle `Navbar.astro` and add the header effect
    - `Navbar.astro`: transparent at the top, `data-scrolled` fades in a background layer (`::before` opacity transition) and a 1px `--border` hairline; ghost links with colour-shift hover; active link keeps its tinted pill; right-side buttons use the outlined pill; mobile toggle is a borderless round icon button with transform-only hamburger animation; drawer keeps `is-open`, `aria-expanded`, `aria-hidden`, focus trap and Escape handling; scroll lock goes through `scrollController.lock('nav-drawer')` and keeps the existing `body.style.overflow` line as the no-Lenis path; drawer content gets `data-lenis-prevent`. Leave the `astro:after-swap` listener untouched. Keep props, link targets and text.
    - `src/lib/motion/header.ts`: registration toggling `data-scrolled` on `#site-header` through a ScrollTrigger (`start: 'top -8'`, `onToggle`); drawer link stagger (opacity and `y`) only under `fullMotion`.
    - _Requirements: 11.1, 11.5, 11.6, 9.3, 9.4, 6.9_

  - [x] 2.7 Restyle `Footer.astro`
    - Flat surface one step lighter than the page (`color-mix(in srgb, var(--bg) 70%, var(--surface))`), 1px `--border` top divider, no gradient or blur. Column titles and the disclosure heading get curly-bracket signatures through CSS generated content with empty alt text (`content: '{ ' / ''`, with a plain fallback line first), so DOM text is unchanged. Add `data-reveal` to the columns. Links get colour-shift hover with the 44px minimum target kept.
    - Keep props, link targets and text.
    - _Requirements: 11.1, 11.5, 2.2_

  - [x] 2.8 Register the new motion effects
    - `src/lib/motion/index.ts`: register `header` and `card-tilt` on `scrollController`.
    - Run `npm run check` and `npm run build`.
    - _Requirements: 11.1, 6.6, 7.2, 7.3_

  - [x] 2.9 Extend `verify-source` for Phase 2
    - Add the "vendored script gone" check (`public/vendor/particles.min.js` must not exist after this phase).
    - **Button rule (replaces the old default check, Open_Decision 2 resolved):** `Button.astro` styles a solid fill only under the `filled` variant; `variant="filled"` appears exactly once in `src/` (the home page hero); no `.astro` file outside `Button.astro` gives a button or `.btn`-type class a solid fill; no `variant="primary"` usage renders filled (guaranteed by the component rule above). Remove the Phase 1 expectation "`Button.astro` still defines a filled `primary`" if it exists.
    - **Card rule (Open_Decision 1 resolved):** `Card.astro` contains no `box-shadow` declaration at all and no `--card-shadow-*` property.
    - Confirm `scripts/verify-baseline.json` has no Background or `particles.min.js` entries and the burn-down logic reports no stale entry.
    - _Requirements: 11.3, 11.8, 11.9, 11.10, 16.2, 16.3_

  - [ ]* 2.10 Write the property test for built-in registrations
    - `tests/logic/motion-registrations.test.mjs`
    - **Property 7: Reduced motion registrations animate only opacity and create no pin or scrub**
    - Run every built-in registration (reveal, header, card-tilt) against the `MotionApi` recorder. Phase 3 re-runs this with its registrations.
    - **Validates: Requirements 6.8, 7.2, 7.3**

  - [x] 2.11 Checkpoint: Phase 2 Phase_Summary and HARD STOP
    - Run `npm run check`, `npm run build`, `npm run test:logic` (if tests exist), `npm run verify:source`, `npm run verify:dist`. Fix failures before reporting.
    - Deliver the **Phase_Summary**: files changed; what was adapted (include: particles.js script replaced by the bundled canvas module, `@ts-ignore` removed, hex colours replaced by tokens, light colour set dropped, `GSAP.md` colours overridden by tokens, Mori replaced by Inter Tight, the gradient-stroke primary built from `--grad-studio-brand`); what could not be done and why.
    - Record the OD1 (no card shadow) and OD2 (outlined pills, one filled hero CTA) resolutions with their dates and the list of converted button call sites (Req 16.11). OD3 and `@types/three` were recorded in Phase 1.
    - **STOP. Do not start Phase 3 until the user replies "go".**
    - _Requirements: 1.1, 1.2, 1.6, 3.6, 11.4, 16.11_

- [x] 3. Phase 3: Hero and home page 3D
  - [x] 3.0 Phase 2 follow-ups: card focus ring and tilt scope
    - Two follow-ups to Phase 2 task 2.5, decided by the user on 2026-10-10 (card focus ring colour, tilt scope). They only touch `src/components/ui/Card.astro`, `src/lib/motion/card-tilt.ts`, `scripts/contrast-pairs.json` and `tests/logic/card-tilt.test.mjs`, so they run alongside 3.1 and 3.4 without conflict.
    - **Card focus ring (decision 2026-10-10).** The keyboard focus ring on cards is drawn with `--text` instead of `--border-focus`: the accent ring measured 2.2 to 2.7:1 on the tinted gradient faces, below the 3:1 of Req 9.4. In `Card.astro` the ring stays on the card face exactly as now (`outline-offset: -2px`, drawn through the stretched link `::after`); only the outline colour changes, for example `outline: var(--state-focus-ring-width) solid var(--text)` in place of `var(--state-focus-outline)` on that rule. **Do not change any colour token** (no edit to `tokens.css`, including `--border-focus` and `--state-focus-*`), and do not change the focus ring of any other component.
    - **Contrast pairs.** In `scripts/contrast-pairs.json` declare the ring pairs for all four card tints (neutral, primary, secondary, accent), each at rest and at hover/focus (8 pairs), each with `fg: "--text"`, `min: 3`, and the same `bg` expressions the existing Card text pairs use (the "title, pill and CTA text on gradient start" expression of the same tint and state, i.e. the lightest gradient-start colour). Labels follow the existing pattern, for example `Card neutral rest: focus ring on gradient start`. Run `npm run verify:source` (and the contrast test if it exists) and **report the 8 measured ratios in the Phase_Summary**. All 8 must pass. **If any pair cannot reach 3:1 with `--text`, stop and report it to the user instead of changing anything else** (no token, tint or opacity changes to make it pass).
    - **Tilt scope (decision 2026-10-10).** `src/lib/motion/card-tilt.ts` must skip cards that have the class `card-wide` or `card-compact`: they keep their CSS lift, get no `data-tilt` attribute and no rotation, no `pointermove` handling and no `quickTo`. Put the selector in one exported constant or pure helper (for example `TILT_CARD_SELECTOR = '.card:not(.card-wide):not(.card-compact)'` or a `shouldTilt(classList)` function) so the rule can be tested without a browser. Behaviour for all other cards is unchanged.
    - **Test.** Extend `tests/logic/card-tilt.test.mjs` (the file already exists, so this is a required update, not an optional test task) with an example for the selector/skip rule: a card with `card-wide` is skipped, a card with `card-compact` is skipped, a card with both is skipped, a plain `.card` and a tinted card without those classes are tilted, and a skipped card never receives `data-tilt`. Run `npm run test:logic`.
    - Run `npm run check`, `npm run build` and `npm run verify:source`.
    - _Requirements: 9.4, 11.5, 11.8, 7.3_

  - [x] 3.1 Implement the particle field and link logic
    - `src/lib/scene/prng.ts` (create it only if task 1.18 was skipped).
    - `src/lib/scene/brain-field.ts`: `PALETTE_SIZE = 4`, `FieldConfig`, `ParticleField`, `BRAIN_BOUND`, deterministic `generateField` (hemisphere sampling, gyri displacement, fissure, cerebellum and stem, ambient shell).
    - `src/lib/scene/links.ts`: `buildLinks` with a uniform grid, ascending `i`, `maxLinks` and `maxDegree`, packed `[i, j]` pairs with `i < j`, deterministic.
    - _Requirements: 12.1, 12.2, 8.8_

  - [ ]* 3.2 Write the property test for particle field generation
    - `tests/logic/brain-field.test.mjs`
    - **Property 12: Particle field generation**
    - **Validates: Requirements 8.8, 12.2**

  - [ ]* 3.3 Write the property test for link topology
    - `tests/logic/links.test.mjs`
    - **Property 13: Link topology matches a reference model**
    - **Validates: Requirements 12.1**

  - [x] 3.4 Implement the scene runtime logic
    - `src/lib/scene/quality.ts`: `Tier`, `SceneEnvironment`, `QualityProfile`, `selectQuality`, `degrade` with the tier table (`poster`, `frame`, `lite` below 768 px, `full`), DPR cap never above 2, typed `Navigator` extensions for `deviceMemory` and `connection.saveData`.
    - `src/lib/scene/run-state.ts`: `RunInputs`, `shouldRun`.
    - `src/lib/scene/webgl-support.ts`: `detectWebGL(doc)` with `failIfMajorPerformanceCaveat` and immediate release of the probe context.
    - `src/lib/scene/idle.ts`: `whenIdle(cb, timeoutMs)` returning a cancel function.
    - `src/lib/scene/disposables.ts`: `createDisposableBag` (`track`, `disposeAll`, each item disposed exactly once).
    - `src/lib/scene/scroll-bridge.ts`: `scrollBridge`, `setScrollProgress` clamping to `[0, 1]` and mapping non-finite to 0. No dependency on `three`.
    - _Requirements: 7.1, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9, 12.6_

  - [ ]* 3.5 Write the property test for the quality profile
    - `tests/logic/quality.test.mjs`
    - **Property 14: Quality profile respects device and motion constraints**
    - **Validates: Requirements 7.1, 8.3, 8.8, 12.6**

  - [ ]* 3.6 Write the property test for the render-loop predicate
    - `tests/logic/run-state.test.mjs`
    - **Property 15: Render loop runs only when everything allows it**
    - **Validates: Requirements 7.1, 8.4, 8.5**

  - [ ]* 3.7 Write the property test for disposal
    - `tests/logic/disposables.test.mjs`
    - **Property 16: Disposal releases every tracked resource exactly once**
    - **Validates: Requirements 8.6**

  - [ ]* 3.8 Write the property test for the scroll bridge
    - `tests/logic/scroll-bridge.test.mjs`
    - **Property 18: Scroll progress is always a unit value**
    - **Validates: Requirements 7.2**

  - [ ]* 3.9 Write example tests for WebGL detection
    - `tests/logic/webgl-support.test.mjs` with a fake `Document`: no context, lost context, context available and released.
    - _Requirements: 8.9_

  - [x] 3.10 Implement the lazy Scene_3D (`ConstellationScene.tsx`)
    - Default export loaded only by dynamic import. Imports `three` by name (no `import * as THREE`) and only `PerformanceMonitor` from drei.
    - `<Canvas frameloop>` driven by `shouldRun` (`demand` when not running, one `invalidate()` on resume), `dpr={[1, quality.dprCap]}`, `gl={{ antialias: false, alpha: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true }}`, camera fov 45 at `[0, 0, 6]`.
    - Geometry in JSX (`bufferGeometry`, `bufferAttribute`, `shaderMaterial`) so R3F disposes it; imperatively created resources go through `DisposableBag`. Triangle glyph shader on `Points` with the four-colour palette read from `--accent`, `--primary`, `--secondary`, `--text` through the token bridge (`Color.setRGB(r, g, b, SRGBColorSpace)`, shader ends with `#include <colorspace_fragment>`, no colour literals). `LineSegments` with `LineBasicMaterial` in `--secondary`.
    - `useFrame`: no state updates; slow rotation, pointer parallax (fine pointer and `full` only), `scrollBridge.progress * 0.6` on X rotation; `t = 0` and no pointer in the `frame` tier.
    - One `AbortController` for pointer, `visibilitychange`, `webglcontextlost`/`webglcontextrestored` (with `preventDefault()`), the `IntersectionObserver` (threshold 0, `rootMargin: '100px'`), and `matchMedia` listeners; abort and disconnect on cleanup. Survive React strict-mode mount, cleanup, mount. `PerformanceMonitor onDecline` applies `degrade`.
    - No `fetch`, no CDN assets, no remote drei helpers.
    - _Requirements: 12.2, 4.4, 7.1, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9, 9.9_

  - [x] 3.11 Implement the island shell, `Scene3D.astro` and `ScenePoster.astro`
    - `src/components/scene/ConstellationIsland.tsx`: `lazy(() => import('./ConstellationScene.tsx'))`, `Suspense`, `SceneBoundary` class component (marks the nearest `.scene` as `failed` and renders `null`; `console.debug` only in DEV), phase machine (`checking`, `poster`, `scene`), `whenIdle(…, 1500)`, `selectQuality`, `detectWebGL`, `matchMedia` listeners for live reduced-motion and width changes. Server render and first client render output nothing so the poster shows (no hydration mismatch). Sets `data-scene-state` (`poster`, `live`, `failed`) on the closest `.scene`.
    - `src/components/scene/Scene3D.astro`: `aspect-ratio: var(--scene-aspect, 1 / 1)`, `contain: layout paint`, `aria-hidden="true"` when decorative, otherwise `role="img"` with a required `aria-label`; the canvas layer fades in with `opacity` only.
    - `src/components/scene/ScenePoster.astro`: the CSS-only poster lifted from `HeroPrism` (aurora gradients, faint flutes, hairline) re-expressed with token variables only.
    - Usage: `<ConstellationIsland client:visible={{ rootMargin: '200px' }} />`.
    - _Requirements: 5.4, 8.1, 8.2, 8.9, 8.10, 9.1, 9.2, 9.5, 12.2_

  - [x] 3.12 Add the scroll-driven motion registrations
    - `src/lib/motion/parallax.ts`: elements with `data-parallax="0.15"` get a scrubbed `yPercent` tween, only for `desktop && fullMotion`.
    - `src/lib/motion/scene-progress.ts`: a scrubbed trigger on the hero section writing `0..1` into `setScrollProgress`, only for `desktop && fullMotion`.
    - `src/lib/motion/magnetic.ts`: `data-magnetic` CTA pull via `quickTo` x/y (max 6 px) only for `fullMotion && finePointer`; no-op otherwise.
    - Register all three in `src/lib/motion/index.ts`.
    - _Requirements: 12.4, 6.6, 6.8, 7.2, 7.3_

  - [x] 3.13 Build the home page hero in `src/pages/index.astro`
    - Hero layout: text left and scene right on desktop; scene behind the text, dimmed, on Mobile_Viewport. One filled `variant="filled"` `size="lg"` CTA in the hero only (the Hero_CTA; set in Phase 2 task 2.4, keep it). The other home page buttons stay outlined. All hero text is Inter Tight. The hero headline uses `--font-size-display-1` with its line-height and letter-spacing tokens, and section headlines use `--font-size-display-3` (tokens from task 1.7; check the final fluid sizes at 360 and 1440 px for overflow). Add `data-reveal` and `data-parallax` hooks to sections.
    - **No text, link or call-to-action changes.** Use token colours only. Mobile uses the `lite` tier or a static frame.
    - Run `npm run check` and `npm run build`; confirm visible text and `href` set equal the baseline.
    - _Requirements: 12.1, 12.3, 12.4, 12.6, 12.7, 2.2, 9.1_

  - [x] 3.14 Retire `HeroPrism.astro`
    - Remove `src/components/HeroPrism.astro` after its poster has moved to `ScenePoster.astro` (design assumption A6) and no import remains. Remove its entries from `scripts/verify-baseline.json`.
    - If anything still depends on it, keep the file instead. Either way, state "removed" or "retained" and why in the Phase_Summary.
    - _Requirements: 12.5_

  - [x] 3.15 Make the Scene_3D dist checks mandatory
    - `scripts/verify-dist.mjs`: the home route must contain a `.scene`; the "three not in the static import closure" check now requires the positive control (a chunk with the markers exists and is reachable only through dynamic `import()`); scene a11y and `aspect-ratio` checks are no longer vacuous.
    - Build and run `npm run verify:dist`.
    - _Requirements: 8.1, 8.2, 9.1, 9.5_

  - [x] 3.16 Add the `ClientRouter` to `BaseLayout.astro` and make the page lifecycle router-safe
    - Decision (2026-10-10): `ClientRouter` is added **now, in Phase 3**, for page transitions. Run this task after 3.13 and 3.14, so the audit in 3.17 knows whether `HeroPrism` still exists.
    - Read the installed Astro version's view-transition API from `node_modules/astro` (docs or types) and confirm the export name and import path (`ClientRouter` from `astro:transitions` in current Astro) before writing the import. Add `<ClientRouter />` to the `<head>` of `src/layouts/BaseLayout.astro`. It must appear exactly once in `src/`.
    - Page lifecycle: `bindPageLifecycle` already maps `astro:before-swap` to leave and `astro:after-swap` to enter (task 1.10). Confirm `src/lib/motion/entry.ts` still binds it exactly once per session (module scripts run once per session under a router), that the initial page load produces a single enter, and that no `astro:page-load` listener exists anywhere (`Select-String -Pattern 'astro:page-load' -Path src -Recurse` returns nothing).
    - `data-motion` gate: on `astro:before-swap`, set `data-motion="pending"` on the incoming document's root (`event.newDocument.documentElement`) so the new page starts hidden and does not flash; on `astro:after-swap`, restart the 2500 ms failure timer so a failed reveal still shows content. Keep this in `entry.ts` or a small module next to it, not in an inline script that would re-run unpredictably.
    - Check and record (do not assume): scroll position after a swap (Lenis re-created at the browser's position; call `ScrollTrigger.clearScrollMemory()` on leave), page `<title>` and meta swap correctly, `/signin` keeps `noindex` and stays unlinked, fragment links (`#main-content`, `#roles`, `#security`) and the skip link still work, and the router's built-in animation is acceptable under Reduced_Motion_Mode.
    - Run `npm run check` and `npm run build`; confirm routes, visible text and `href` set still equal the baseline.
    - _Requirements: 12.8, 12.10, 12.11, 6.5, 6.7, 2.1, 2.2_

  - [x] 3.17 Audit and adapt every existing script for `astro:before-swap` / `astro:after-swap`
    - Standard pattern for each script (design section 15): `setup(): Cleanup`, run through `bindPageLifecycle(createGate(setup), { document, window })`. `setup` owns one `AbortController` (all listeners get `{ signal }`), every observer and animation frame, and returns a cleanup that aborts, disconnects, cancels, releases scroll locks and removes attributes it added. Enter re-queries the new DOM; leave tears everything down. Replace each script's own `document.addEventListener('astro:after-swap', …)` re-setup with this pattern.
    - Audit and adapt, one at a time, recording in the Phase_Summary what each script did before, what changed and how it was verified: `src/components/Navbar.astro` (drawer toggle, Escape, focus trap, link close, resize, `scrollController.lock('nav-drawer')`: drawer closed and lock released on leave), `src/components/ui/Card.astro` (confirm no document-level listener is left outside the `card-tilt` registration), `src/pages/contact/index.astro` (copy-button script), `src/pages/signin/index.astro` (toggle script; page stays `noindex`, unlinked, no network, no storage), `src/components/ui/Background.astro` (abort on leave, fresh canvas lookup on enter), `src/components/scene/ConstellationIsland.tsx` (confirm the island unmounts when its DOM is removed and rebuilds on the new page, with no WebGL context left behind), `src/lib/motion/entry.ts`, `src/components/HeroPrism.astro` only if task 3.14 retained it (otherwise note that it is gone), and every other `<script>` found by `Get-ChildItem src -Recurse -Include *.astro | Select-String '<script'`.
    - Keep behaviour, text and links unchanged (Req 2.2); only lifecycle plumbing changes. Mobile menu, copy button, sign-in toggle and card hover must behave exactly as before after one, two and five client-side navigations.
    - Remove the `unmanaged-listener` entries from `scripts/verify-baseline.json` as each script is fixed. The file must have none left for these scripts when this task ends.
    - Run `npm run check`, `npm run build` and `npm run verify:source`.
    - _Requirements: 12.9, 12.10, 6.5, 6.6, 6.7, 2.2, 13.4_

  - [x] 3.18 Flip the verify checks to expect the router
    - `scripts/verify-source.mjs`: replace "no `ClientRouter` in `src/`" with "`ClientRouter` appears exactly once, in `src/layouts/BaseLayout.astro`"; keep "no `astro:page-load` listener in `src/`"; the `unmanaged-listener` rule now runs without baseline entries.
    - `scripts/verify-dist.mjs`: every built HTML page carries the view-transitions marker (confirm its exact form in the installed Astro version); `/signin/` still has `noindex`, every `<form>` still has `novalidate`, and no route links to `/signin`.
    - Build and run `npm run verify:source` and `npm run verify:dist`.
    - _Requirements: 12.8, 12.9, 12.10, 12.11, 13.4_

  - [ ]* 3.19 Extend the lifecycle gate test for router events
    - `tests/logic/gate.test.mjs` (same file as 1.19, extend it)
    - **Property 1: Gate balance and idempotence**, applied to arbitrary interleavings of `astro:before-swap`, `astro:after-swap`, `pagehide` and `pageshow` (persisted and not): the gate ends balanced, is active only after the last effective enter, and `astro:page-load` changes nothing.
    - **Validates: Requirements 6.5, 6.7**

  - [x] 3.20 Checkpoint: Phase 3 Phase_Summary and HARD STOP
    - Run `npm run check`, `npm run build`, `npm run test:logic` (if tests exist), `npm run verify:source`, `npm run verify:dist`. Re-run the registrations test (2.10) if it exists. Fix failures before reporting.
    - Deliver the **Phase_Summary**: files changed; what was adapted (include: the four hues mapped to `--accent`, `--primary`, `--secondary`, `--text`; connecting lines added per the requirements glossary and kept in `--secondary` at about 0.25 opacity (confirmed assumption A9); poster moved from HeroPrism; PPNeueMontreal replaced by Inter Tight in the hero; the `ClientRouter` added; the Card focus ring drawn with `--text`; the card tilt scope); what could not be done and why. The Phase_Summary must also include:
      - **Focus ring ratios from 3.0:** the 8 measured ratios (neutral, primary, secondary, accent, each at rest and at hover/focus), each against its minimum of 3, and the decision date 2026-10-10 for the ring colour and the tilt scope.
      - **HeroPrism:** removed or retained, and why (Req 12.5).
      - **Payload:** gzip size of the eager JS per route (from the `verify:dist` table) and gzip size of the lazy 3D chunk (the chunk that holds `three`). Note that the 60 fps target (Req 8.7) is measured in Phase 5, not assumed.
      - **Adapted from `hero_section.md`:** what was taken from it and what was changed (colours to tokens, font, copy, layout, anything dropped).
      - **Per-script audit results from 3.17:** for each script, what it did before, what changed, how it was verified after one, two and five client-side navigations.
      - **To do in Phase 4 (remaining `box-shadow` and related items, not fixed in Phase 3):** `src/components/Badge.astro`; `src/components/ui/Input.astro` (its focus ring needs an outline replacement, not only deletion of the shadow); `src/pages/index.astro` around line 451; `src/pages/signin/index.astro` around line 218; `src/styles/global.css` around lines 202 and 209; plus the Contact copy button pill (4.8) and the sign-in items (4.7). Re-check the line numbers with a search, they are approximate.
      - **Browser checklist for this phase** (for the user to run against `npm run preview`; mark each as done or could not check): hero scene at 360 px and at 1440 px (renders, poster fallback, no horizontal scroll); scroll effects (reveal, parallax, header state, card tilt on a fine pointer, no tilt on `card-wide` and `card-compact`); page transitions between routes (no flash, correct scroll position, title and meta swap); the mobile drawer and where focus lands after a transition; the card keyboard focus ring visible on all four tints; reduced motion (fade only, no Lenis, no tilt, no canvas motion, live toggle).
    - **STOP. Do not start Phase 4 until the user replies "go".**
    - _Requirements: 1.1, 1.2, 1.6, 3.6, 12.5, 12.8, 12.9, 9.4_

- [ ] 4. Phase 4: About, products, contact, sign-in, 404, privacy, terms
  - [x] 4.1 Contact reference gate: verify the new export (ask only if it is missing or unreadable)
    - Decision (2026-10-10): the user puts a new, legible Contact_Replacement in `refrence/` before Phase 4. List `refrence/` and pick the newest image whose name contains `contact` (the previous file is `contact_page.png`, 131 KB, downscaled and very tall, structure readable but body text not legible; the requirements originally named `CONTACT_PAGE.jpg`). Record the file name chosen.
    - Verify: the file opens, its size is under 2 MB, and the text in it is legible when the image is viewed. This is a check, **not a question**: if the file is present, readable, under 2 MB and legible, continue without asking the user (Req 14.1, 14.3).
    - Use the `user_input` tool (reason `general-question`) **only** if the file is missing or cannot be opened, is 2 MB or larger, or is still illegible. Then ask the user for another export and STOP and wait (Req 14.1, 14.5). Do not design the Contact_Page layout from assumption. If the only usable file is the old `contact_page.png`, ask whether a structure-only adaptation is acceptable before using it.
    - If no usable reference exists, leave `src/pages/contact/index.astro` unmodified and carry it to the Phase_Summary as incomplete (Req 14.2).
    - Do not modify any file in `refrence/`. The new export is a user-added file: `verify-source` reports it as "new, not hashed" without failing; add its hash to `reference-hashes.json` once it is the confirmed reference.
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 2.4_

  - [x] 4.2 Add the Contact reference size check to `verify-source`
    - In `scripts/verify-source.mjs`: if a Contact_Replacement file path is recorded (confirmed in 4.1), fail when its size is 2 MB or more. Legibility stays a human decision recorded in the Phase_Summary.
    - _Requirements: 14.3, 14.5_

  - [x] 4.3 Restyle and animate the About page
    - **Note: Phase 4 box-shadow removals (carried over from Phase 3, 2026-10-10).** These are Phase 4 work and no new task is created for them. Remove them in the Phase 4 task that touches the file, or here if no other Phase 4 task does: `src/components/Badge.astro`; `src/components/ui/Input.astro` (its focus ring needs an `outline` replacement, not only deletion of the shadow, so the 3:1 focus indicator of Req 9.4 stays); `src/pages/index.astro` around line 451; `src/pages/signin/index.astro` around line 218 (done in 4.7); `src/styles/global.css` around lines 202 and 209; and the Contact copy button pill (done in 4.8). Re-check the line numbers with a search. Hover or focus styles that lose a shadow get a border colour step or an outline instead, with no colour token edits and no copy changes. Whatever remains when Phase 4 ends is listed in the 4.9 Phase_Summary and carried to the 5.1 burn-down.
    - `src/pages/about/index.astro`: typography, spacing, entrance motion and `data-reveal` hooks per the GSAP_Spec, tokens only. Page titles use `--font-size-display-2` and section titles `--font-size-display-3` (with their line-height and letter-spacing tokens); body text stays within the cap of 10 body sizes (`font-size-budget` passes). Buttons on the page stay outlined pills (the primary action is the gradient-stroke pill). No copy, link or data changes.
    - _Requirements: 13.1, 2.2_

  - [x] 4.4 Restyle and animate the Products pages
    - `src/pages/products/index.astro`, `products/setu/index.astro`, `products/field-book/index.astro`: same treatment as 4.3 (display tokens for titles, outlined buttons only, `font-family` stays on the Inter Tight tokens including the Setu SVG labels). No copy, link or data changes.
    - _Requirements: 13.1, 2.2_

  - [x] 4.5 Restyle the Privacy and Terms pages
    - `src/pages/privacy/index.astro`, `terms/index.astro`: only typography (page titles on `--font-size-display-2`), spacing and entrance motion change; all text retained exactly.
    - _Requirements: 13.1, 13.2, 2.2_

  - [x] 4.6 Restyle the 404 page
    - `src/pages/404.astro`: typography (heading on a display token), spacing, entrance motion; buttons are outlined pills (the home button is the gradient-stroke pill); no copy changes.
    - _Requirements: 13.1, 2.2_

  - [x] 4.7 Port the Signin_Spec to the sign-in page
    - Before editing, capture reference screenshots of both modes at 1440 and 360 px if browser tooling is available (ask the user to run `npm run preview` if needed); otherwise record this under "what could not be done".
    - `src/pages/signin/index.astro`, per design section 11: keep behaviour untouched (inert forms with `novalidate`, `noindex`, no network, no storage, unlinked, `inert` toggling, live region, focus moved to the new form heading). Replace layout-property motion with transforms: form wrapper fixed at `left: 0; width: 50%` and moved with `translate`; big circle fixed and moved with `translate` using container-query units (`.auth { container-type: size }`); mobile (≤ 870px) variant with `cqw/cqh` translates. `transition` lists only `transform` and `opacity` (`transition: all 0.2s 0.7s` on `form` becomes `transition: opacity 0.2s 0.7s`). Timings kept as custom properties on `.auth`. `will-change: transform` on the circle only while a switch is in progress. Card joins the shared `reveal`. Reduced motion keeps instant swaps. Social icons use `currentColor`, no brand hex.
    - Remove the remaining `box-shadow` near line 218 of this page (Phase 4 box-shadow note under 4.3).
    - Remove the sign-in entries from `scripts/verify-baseline.json`.
    - After editing, compare circle, wrapper and panel positions with the pre-port screenshots within 1 px, or record that this could not be done.
    - Record the `left` to transform replacement as an adaptation (Req 13.5).
    - _Requirements: 13.3, 13.4, 13.5, 13.6, 6.9, 3.6_

  - [x] 4.8 Build the Contact page from the confirmed reference
    - Only after 4.1 is resolved. If no reference was confirmed, make no change and record the Contact_Page as incomplete in the Phase_Summary.
    - Build the layout from the Contact_Replacement verified in 4.1, adapting it minimally. If (and only if) the user accepted the structure-only `contact_page.png`, use this mapping: `src/pages/contact/index.astro` left column with badge, H1, lead; right column with the existing Primary Email card (Compose and Copy actions); channel cards (GitHub, LinkedIn, secondary channels) in the card row; shared Footer. Blocks with no counterpart on the site (case study, video, logo strip, CTA band) are not used. Reference amber accent maps to `--accent`; colours, type and radii from tokens.
    - Preserve all existing copy and the clipboard script with its failure handling. Move the clipboard failure `console.warn` into an `import.meta.env.DEV` branch so production writes nothing to the console (Req 9.2) and the strict `console` rule passes in Phase 5; user-visible behaviour is unchanged. Remove the Contact entry from `scripts/verify-baseline.json` and report the change as an adaptation. If the Contact_Page is left incomplete (4.1), do the same one-line move anyway only if the user agrees; otherwise carry the entry to Phase 5 and report it. Add no form.
    - If task 2.4 reported that the raw copy-email `<button>` on this page has a solid fill, restyle it as an outlined pill here (Open_Decision 2: filled only in the hero). The clipboard script keeps its Phase 3 gate-bound setup (task 3.17).
    - _Requirements: 14.4, 14.3, 2.2, 2.5, 11.10, 16.3_

  - [x] 4.9 Checkpoint: Phase 4 Phase_Summary and HARD STOP
    - Run `npm run check`, `npm run build`, `npm run test:logic` (if tests exist), `npm run verify:source`, `npm run verify:dist`. Fix failures before reporting.
    - Deliver the **Phase_Summary**: files changed; what was adapted (include: Signin_Spec `left`/`right`/`top`/`bottom` transitions replaced by transforms, brand hex colours not reintroduced, contact mapping choices); what could not be done and why. State the Contact_Page status (complete from which reference, or incomplete and why). List which of the box-shadow removals noted under 4.3 are done and which remain.
    - **STOP. Do not start Phase 5 until the user replies "go".**
    - _Requirements: 1.1, 1.2, 1.6, 3.6, 13.5, 14.2_

- [ ] 5. Phase 5: QA at 360, 768, 1024 and 1440 px, reduced motion, and performance
  - [x] 5.1 Burn the baseline down to zero and switch CI to strict
    - Resolve any remaining entries in `scripts/verify-baseline.json` (it must end empty), fixing the source, not the baseline. The one exception is the Contact `console.warn` entry when the Contact_Page stayed unmodified under Req 14.2: ask the user whether the one-line DEV-only move may be made; if not, report it under "what could not be done" and run strict mode with that single entry documented.
    - Change CI to run `npm run verify:source -- --strict`.
    - _Requirements: 15.6, 4.2, 6.9, 9.2, 9.6_

  - [x] 5.2 Run the full automated verification
    - Run, in order: `npm run check`, `npm run test:logic` (if tests exist), `npm run verify:source -- --strict`, `npm run build`, `npm run verify:dist`. Confirm zero hard-coded colours, zero Layout_Property tweens or transitions, zero `any`, zero `@ts-ignore`/`@ts-expect-error`, Typecheck zero errors, Build exit code 0. Fix failures in the files from earlier phases.
    - Confirm the protected-area and reference-hash checks pass.
    - _Requirements: 15.6, 15.7, 9.7, 9.8, 2.3, 2.4_

  - [~] 5.3 QA: Test_Widths and Reduced_Motion_Mode on every route
    - For each route in the Page_Set (`/`, `/about`, `/products`, `/contact`, `/signin`, `/privacy`, `/terms`, 404) at 360, 768, 1024 and 1440 px: `document.documentElement.scrollWidth <= clientWidth`, no overlapping content.
    - With `prefers-reduced-motion: reduce` emulated: no canvas motion, no Lenis class on `<html>`, no pinned or scrubbed ScrollTrigger, fade-only animation; toggle the setting live and confirm the switch without reload.
    - Use available browser tooling against a preview server the user runs (`npm run preview`). Record each result, or "could not measure" with the reason.
    - _Requirements: 15.1, 15.2, 15.3, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [~] 5.4 QA: lifecycle, leaks, console and failure modes
    - Navigate between routes through the ClientRouter (link clicks), then use back/forward and bfcache restores, 10 times each: the DEV stats hook shows at most one Lenis, at most one ticker callback, a bounded ScrollTrigger count; no WebGL context growth after the island unmounts. Strict mode: one Lenis and one canvas.
    - Console is clean (no errors or warnings) while loading, scrolling, navigating, resizing on every route.
    - WebGL disabled: poster shows and no `three` chunk is requested. `ConstellationScene` blocked: page content stays visible and usable. Scene paused offscreen and in a hidden tab.
    - Record each result, or "could not measure" with the reason.
    - _Requirements: 15.4, 6.5, 6.7, 8.4, 8.5, 8.6, 8.9, 8.10, 9.2_

  - [~] 5.5 QA: keyboard, focus and contrast
    - Tab through every route and the open mobile drawer: every interactive element reachable, visible focus ring, Escape closes the drawer and returns focus to the toggle, `aria-expanded` accurate. Spot-check text contrast over the animated background and hero at 360 and 1440 px against the 4.5:1 requirement.
    - State plainly that full accessibility validation needs assistive-technology testing beyond this check.
    - _Requirements: 15.5, 9.3, 9.4, 4.6, 11.6_

  - [~] 5.6 QA: performance measurements for the home page
    - Measure median and 1% low frame rate over 10 s of scroll, total layout shift (expected 0 from the Upgrade), and the eager JavaScript payload (from the `verify:dist` table, and confirm `three` is requested only after the hero nears the viewport).
    - Report each figure, or state "could not measure" with the reason (for example no mid-range reference device available).
    - _Requirements: 15.8, 8.2, 8.7, 9.1_

  - [~] 5.7 Final checkpoint: Phase 5 Phase_Summary and HARD STOP
    - Deliver the **Phase_Summary**: files changed; what was adapted; what could not be done and why; the per-route, per-width and reduced-motion results; measured frame rate, layout shift and JavaScript payload for the home page, with any measurement that could not be taken stated explicitly (Req 15.8). Offer to write `.kiro/specs/frontend-3d-upgrade/qa-report.md` only if the user asks.
    - Include the final status of every Open_Decision with dates.
    - **STOP. The Upgrade is complete once the user accepts this summary.**
    - _Requirements: 1.1, 1.2, 1.6, 15.8, 16.8_

## Notes

- Tasks marked with `*` are optional (test-related) and can be skipped for a faster MVP. The verification scripts, scanner libraries, baseline files and CI wiring are required.
- Each phase ends with a checkpoint task (1.34, 2.11, 3.20, 4.9, 5.7). It produces the Phase_Summary and stops until the user says "go".
- **Renumbering (2026-10-10).** Phase 1 gained tasks 1.5 to 1.7, so the old tasks 1.5 to 1.31 are now 1.8 to 1.34 (offset +3). Phase 2 lost the old tasks 2.1 and 2.2 (both decisions are resolved, so there is nothing to ask), so the old 2.3 to 2.13 are now 2.1 to 2.11. Phase 3 gained tasks 3.16 to 3.19 and its checkpoint is now 3.20. Task 3.0 was added later (2026-10-10) without renumbering 3.1 to 3.20. Phases 4 and 5 keep their numbers. Old mentions of "task 1.15", "1.12", "2.12" and similar in earlier notes now mean 1.18, 1.15 and 2.10.
- **Decisions resolved on 2026-10-10 and where they are applied:** `@types/three` approved (1.1, installed in 1.4); fonts, Inter Tight for all text (1.5, 1.6); display font-size tokens and the amended old size check (1.7, enforced by 1.15); no card box-shadow (2.5); outlined pills with a gradient-stroke primary and one filled hero CTA (2.4); `ClientRouter` in Phase 3 (3.16 to 3.18); Contact export verified, not asked, in Phase 4 (4.1). There are no open decisions.
- **Documented exceptions to "do not edit `tokens.css`"** (both are non-colour): the three `--font-*` stacks (1.5) and the display tokens (1.7). Both are listed in the Phase 1 Phase_Summary.
- **Decisions of 2026-10-10 added to Phase 3 (task 3.0):** card keyboard focus ring drawn with `--text` (no token change, 8 contrast pairs at 3:1 declared and reported); card tilt skips `card-wide` and `card-compact`. Remaining `box-shadow` removals (Badge, Input, home page, sign-in, `global.css`, Contact copy button) are Phase 4 work, noted under 4.3.
- **Unchanged by decision (2026-10-10):** the skip link stays as it is, and the solid-fill button check stays opaque-only.
- Phase 1 must not add `ClientRouter` (Req 10.6); the `verify-source` router check enforces this until task 3.18 flips it.
- Property tests depend on `tests/logic/_pbt.mjs` (task 1.18). Tests in the same file (`scroll-controller.test.mjs`, `gate.test.mjs`) are in separate waves so they do not write the same file at once.
- Checkpoint tasks and parent tasks are not in the dependency graph. Waves never mix phases: every wave of phase N completes, and the user's "go" is received, before phase N+1 begins. Phase 1 is the only phase to execute until that "go".
- Property tests validate universal correctness properties of the project's own logic. Browser behaviour, pixels, frame rate and layout shift are measured in Phase 5.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.2", "1.3", "1.14"] },
    { "id": 1, "tasks": ["1.4", "1.9", "1.10"] },
    { "id": 2, "tasks": ["1.5", "1.11"] },
    { "id": 3, "tasks": ["1.6", "1.8", "1.12"] },
    { "id": 4, "tasks": ["1.7", "1.13", "1.16", "1.18"] },
    { "id": 5, "tasks": ["1.15", "1.19", "1.20", "1.24", "1.25", "1.26", "1.27", "1.28", "1.30", "1.31", "1.32", "1.33"] },
    { "id": 6, "tasks": ["1.17", "1.21", "1.29"] },
    { "id": 7, "tasks": ["1.22"] },
    { "id": 8, "tasks": ["1.23"] },
    { "id": 9, "tasks": ["2.1", "2.7"] },
    { "id": 10, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 11, "tasks": ["2.8", "2.9"] },
    { "id": 12, "tasks": ["2.10"] },
    { "id": 13, "tasks": ["3.0", "3.1", "3.4"] },
    { "id": 14, "tasks": ["3.2", "3.3", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.12"] },
    { "id": 15, "tasks": ["3.11"] },
    { "id": 16, "tasks": ["3.13"] },
    { "id": 17, "tasks": ["3.14", "3.15"] },
    { "id": 18, "tasks": ["3.16"] },
    { "id": 19, "tasks": ["3.17"] },
    { "id": 20, "tasks": ["3.18", "3.19"] },
    { "id": 21, "tasks": ["4.1", "4.3", "4.4", "4.5", "4.6", "4.7"] },
    { "id": 22, "tasks": ["4.2", "4.8"] },
    { "id": 23, "tasks": ["5.1"] },
    { "id": 24, "tasks": ["5.2"] },
    { "id": 25, "tasks": ["5.3", "5.4", "5.5", "5.6"] }
  ]
}
```
