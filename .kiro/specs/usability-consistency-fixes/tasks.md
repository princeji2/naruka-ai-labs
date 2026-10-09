# Implementation Plan: Usability and Consistency Fixes

## Overview

Four CSS-level fixes on the Naruka AI Labs Astro site (Astro / TypeScript / CSS). Top-level tasks 1 to 4 keep the issue numbering from `requirements.md` and `design.md`:

1. Type scale: replace hardcoded `rem` and `clamp()` font sizes with `--font-size-*` tokens (10 distinct sizes, none below 12px).
2. Corner radii: replace raw `2px` and `3px` radii with `var(--radius-xs)`, keep `50%` on true circles.
3. Hero badge casing: `Badge.astro` picks uppercase or mixed case from label length (20 characters or fewer is short).
4. Product tagline casing: `.card-tagline` drops forced uppercase and tracking, and the two taglines move to sentence case.

Tasks 5 to 8 are checkpoints and verification. The project has no test runner, so verification uses `npm run build`, `npm run check`, PowerShell source scans, and a scan of the built HTML in `dist/`. These are the correctness checks for Properties 1 to 7 in the design. Nothing is added to the repository for verification, and `src/styles/tokens.css` is not edited.

`.hero-lead` interpretation (requirements 1.5, Fixed_Size_Clamp): a `clamp()` whose maximum is within 2px of a discrete token is treated as a fixed size. `clamp(1.1rem, 2vw, 1.25rem)` therefore maps to `--font-size-2xl`, not `--font-size-5xl`.

## Tasks

- [x] 1. Issue 1: Type scale
  - [x] 1.1 Replace font sizes in `src/pages/index.astro`
    - Replace every hardcoded `rem` font size using the rem-to-token table in the design. Use exact-match replacement per value so `0.8rem` cannot be confused with `0.825rem`.
    - `.hero-lead`: `clamp(1.1rem, 2vw, 1.25rem)` to `var(--font-size-2xl)` (Fixed_Size_Clamp).
    - `.section-title`: `clamp(1.8rem, 3.2vw, 2.5rem)` to `var(--font-size-5xl)`.
    - `.cta-heading`: `clamp(1.8rem, 3.5vw, 2.5rem)` to `var(--font-size-5xl)`.
    - Stat figure (`2rem`, around line 471): `var(--font-size-4xl)`.
    - `.card-tagline`: `0.85rem` to `var(--font-size-sm)`. Leave its `text-transform` and `letter-spacing` for task 4.1.
    - Leave `font-weight`, `line-height`, `letter-spacing` and all other declarations alone.
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 Replace font sizes in `about`, `privacy` and `terms` pages
    - `src/pages/about/index.astro`: `clamp(2.2rem, 4vw, 3.25rem)` to `var(--font-size-6xl)`.
    - `src/pages/privacy/index.astro`: replace the 5 `rem` sizes per the mapping table, and `clamp(2.2rem, 3.5vw, 3rem)` to `var(--font-size-6xl)`.
    - `src/pages/terms/index.astro`: same as privacy.
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

  - [x] 1.3 Replace font sizes in the products pages
    - `src/pages/products/index.astro`: replace the 9 `rem` sizes per the mapping table.
    - `src/pages/products/field-book/index.astro`: replace `rem` sizes per the table, and `clamp(1.8rem, 3vw, 2.4rem)` to `var(--font-size-5xl)`.
    - `src/pages/products/setu/index.astro`: same as field-book.
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

  - [x] 1.4 Drop the `--font-size-xl` references
    - `src/components/Navbar.astro` `.mobile-nav-link`: `var(--font-size-xl)` to `var(--font-size-lg)`.
    - `src/styles/global.css` `h6`: `var(--font-size-xl)` to `var(--font-size-lg)`.
    - Keep `--font-size-xl` defined in `src/styles/tokens.css`, which stays untouched.
    - _Requirements: 1.2, 1.6, 1.7_

  - [x] 1.5 Scan font sizes for leftovers and undefined tokens (Property 1)
    - **Property 1: Font sizes use only existing tokens**
    - From the repository root, run the three searches from the design's Testing Strategy. Each must return no matches:
      - `Get-ChildItem src -Recurse -Include *.astro,*.css | Select-String -Pattern 'font-size\s*:\s*(\d|\.|clamp)'`
      - `Get-ChildItem src -Recurse -Include *.astro,*.css | Select-String -Pattern 'font-size\s*:\s*(?!var\(--font-size-)'`
      - `Get-ChildItem src -Recurse -Include *.astro,*.css | Select-String -Pattern 'var\(--font-size-xl\)'`
    - Confirm every referenced `--font-size-*` name exists in `src/styles/tokens.css`, since a misspelled token is valid CSS and is not caught by the build.
    - Fix any leftover and rerun until all searches are clean.
    - **Validates: Requirements 1.1, 1.10**

  - [x] 1.6 Count distinct resolved font sizes (Property 2)
    - **Property 2: Distinct font size budget and floor**
    - Run the resolved-size script from the design's Testing Strategy. Expected output is exactly 10 entries: `12`, `14`, `17`, `18`, `21`, `25.5`, `28`, `fluid 21-36`, `fluid 25.5-48`, `fluid 28-60`. No entry may be below 12 and no `$null` entry may appear.
    - **Validates: Requirements 1.2, 1.3**

- [x] 2. Issue 2: Corner radii
  - [x] 2.1 Replace raw `2px` and `3px` radii with `var(--radius-xs)`
    - `src/components/Navbar.astro`: `.hamburger-inner` and its `::before` and `::after` (`2px`).
    - `src/pages/privacy/index.astro` and `src/pages/terms/index.astro`: `.legal-section code` (`3px`).
    - `src/pages/products/field-book/index.astro`: `.workflow-callout code` (`3px`).
    - `src/pages/products/setu/index.astro`: `.spec-list code` (`3px`).
    - `src/pages/index.astro`: `.roadmap-list code` (`3px`).
    - Keep `50%` on `.live-pulse` (8px by 8px), `.dot-amber` (6px by 6px) and `.roadmap-indicator` (8px by 8px), which are true circles. Keep the `0 var(--radius-xs) var(--radius-xs) 0` shorthands.
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.2 Scan radius values (Property 3)
    - **Property 3: Radius values come from the allowed forms**
    - Run `Get-ChildItem src -Recurse -Include *.astro,*.css | Select-String -Pattern 'border-radius\s*:\s*[0-9.]+(px|rem)'`. It must return no matches.
    - Run the `border-radius\s*:\s*50%` search with `-Context 4,0` and confirm the only hits are `.live-pulse`, `.dot-amber` and `.roadmap-indicator`.
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.9**

  - [x] 2.3 Count distinct radii (Property 4)
    - **Property 4: Distinct radius budget**
    - Run the distinct-value search from the design's Testing Strategy. Expected values: `0 var(--radius-xs) var(--radius-xs) 0`, `50%`, `var(--radius-full)`, `var(--radius-lg)`, `var(--radius-md)`, `var(--radius-sm)`, `var(--radius-xs)`. After normalizing the shorthand to `--radius-xs`, that is 6 distinct radii.
    - **Validates: Requirements 2.5**

- [x] 3. Issue 3: Badge casing by label length
  - [x] 3.1 Add the label length classification to `src/components/Badge.astro` frontmatter
    - Add `const LONG_LABEL_THRESHOLD = 20;` with the explanatory comment from the design.
    - Compute `displayText = text || defaultTexts[variant]`, `isLongLabel = Array.from(displayText.trim()).length > LONG_LABEL_THRESHOLD`, and `lengthClass`.
    - Add `lengthClass` to the root `<span>` class list. Keep the dot span and the `badge-label` span as they are.
    - Do not use `toUpperCase()` or `toLowerCase()`, and do not edit any page call site.
    - _Requirements: 3.4, 3.5, 3.6_

  - [x] 3.2 Update the `Badge.astro` styles
    - In `.badge`, remove `letter-spacing: 0.02em;`, `text-transform: none;` and the comment above them.
    - Add `.badge-short { text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); }`.
    - Add `.badge-long { text-transform: none; letter-spacing: 0.02em; }`.
    - Keep variants, colors, dot, padding, ellipsis handling and `font-size: var(--font-size-xs)`.
    - _Requirements: 3.1, 3.2, 3.6_

  - [x] 3.3 Scan the Badge source (Property 6, source part)
    - **Property 6: Badge casing never changes the text**
    - Run `Select-String -Path src/components/Badge.astro -Pattern 'badge-short|badge-long|text-transform|letter-spacing|toUpperCase|toLowerCase'`. Casing rules must appear only in `.badge-short` and `.badge-long`, and there must be no `toUpperCase` or `toLowerCase`.
    - Run `git diff --stat -- src/pages` and confirm that no page changes are badge call-site edits.
    - **Validates: Requirements 3.4, 3.5**

- [x] 4. Issue 4: Product tagline casing
  - [x] 4.1 Update `.card-tagline` and the two tagline strings in `src/pages/index.astro`
    - Remove `text-transform: uppercase;` and `letter-spacing: 0.05em;` from `.card-tagline`. Keep `color: var(--text-muted)` and `font-weight: 600`. The `font-size: var(--font-size-sm)` line comes from task 1.1.
    - Line 63: `Citizen-Centric Interoperability Gateway` to `Citizen-centric interoperability gateway`.
    - Line 101: `Campus Event Attendance & Credentialing Ledger` to `Campus event attendance & credentialing ledger`.
    - Change only the text inside the two `<p class="card-tagline">` elements.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 4.2 Scan the tagline source
    - Run `Select-String -Path src/pages/index.astro -Pattern '\.card-tagline\s*\{' -Context 0,6`. The rule must show no `text-transform` or `letter-spacing`, and must keep `color` and `font-weight: 600`.
    - Run `Select-String -Path src/pages/index.astro -Pattern 'Citizen-Centric|Campus Event Attendance'`. It must return no matches.
    - _Requirements: 4.1, 4.4, 4.7_

- [x] 5. Checkpoint - Source scans pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Build and project checks
  - [x] 6.1 Run `npm run build`
    - Run from the repository root. It must exit with code 0. Fix any error before moving on.
    - _Requirements: 1.8, 2.7, 3.7, 4.5_

  - [x] 6.2 Run `npm run check`
    - Run from the repository root. It must exit with code 0 and report 0 errors.
    - _Requirements: 1.9, 2.8, 3.8, 4.6_

  - [x] 6.3 Confirm the token file is unchanged (Property 7)
    - **Property 7: Token file is unchanged**
    - Run `git diff --stat -- src/styles/tokens.css`. It must produce no output.
    - **Validates: Requirements 1.7, 2.6**

- [x] 7. Built output verification (`dist/`)
  - [x] 7.1 Run the dist badge scan (Properties 5 and 6)
    - **Property 5: Badge casing follows label length**
    - **Property 6: Badge casing never changes the text**
    - Run the badge scan script from the design's Testing Strategy over every `dist/**/*.html`. It must print `N badges checked, 0 mismatches`.
    - Compare the printed labels against the `text=` values from `Select-String -Pattern '<Badge' -Path src/pages -Recurse` to confirm the text is unchanged.
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.9**

  - [x] 7.2 Check the hero badge and taglines in `dist/index.html`
    - Run `Select-String -Path dist/index.html -Pattern '(?s)badge-long.{0,300}Founder-Led Product Studio'`. It must match, with the text in its original mixed case.
    - Run `Select-String -Path dist/index.html -Pattern 'Citizen-centric interoperability gateway'` and `Select-String -Path dist/index.html -Pattern 'Campus event attendance &(amp;)? credentialing ledger'`. Both must match.
    - **Validates: Requirements 3.3, 3.9, 4.2, 4.3**

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Top-level tasks 1 to 4 match issue numbers 1 to 4 in `requirements.md` and `design.md`. Tasks 5 to 8 are checkpoints and verification.
- The verification sub-tasks are not marked optional. The project has no test runner, so these scans and commands are the only checks that the fixes hold.
- Task 1.1 owns the `.card-tagline` font size, and task 4.1 owns the casing and text. Both edit `src/pages/index.astro`, so they run in different waves.
- `--font-size-xl` stays defined in `src/styles/tokens.css` and is simply unreferenced after task 1.4.
- The visual spot check in the design (375px and 1440px for the hero badge, product cards, `.hero-lead`, stat figure, section headings and mobile nav) needs `npm run preview` and a browser, so it is left for you to run manually.
- Phone-sized headings shrink by 5px to 6px because of the fluid tokens. This is expected under requirements 1.5 and 1.7.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "3.1"] },
    { "id": 1, "tasks": ["1.5", "1.6", "2.1", "3.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.3", "4.1"] },
    { "id": 3, "tasks": ["4.2", "6.1", "6.3"] },
    { "id": 4, "tasks": ["6.2", "7.1", "7.2"] }
  ]
}
```
