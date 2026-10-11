# Typography polish — verification note (final: display-1 lowered, user-authorized Setu buttons kept)

This note describes the EXACT on-disk working-tree state the five checks were run against.

## Resolution of the two parent-session rulings

### Ruling 1 — home H1 line-count conflict → Option A (lower display-1)

At the earlier target display-1 (clamp 40 → 72px) the home H1
"Naruka AI Labs builds practical AI-powered software products." wrapped to 4 lines @1440
and 5 lines @360 at every measure 16–30ch (text-wrap:balance plus the long tokens could not
pack into 3 lines at 72px). The task's line-count ceiling (home H1 ≤3 lines @1440, ≤4 @360) is
a hard requirement and the task authorizes adjusting the display numbers if a check fails.

Shipped: `--font-size-display-1: clamp(38px, 2.41vw + 29.33px, 64px)` (38px@360 → 64px@1440).
Weight 600, letter-spacing −0.02em, line-height 1.08 unchanged. The hero is ~11% smaller at
desktop than the earlier 72px — a deliberate adaptation to satisfy the line-count rule without
touching copy. display-2 (34 → 60px) and display-3 (26 → ~42px) left as approved.

Re-measured home H1 (headless Chrome against the built dist): 360px = 4 lines, 768px = 4 lines,
1440px = 3 lines. Worst vertical ink gap +4px (360) / +5px (768) / +7px (1440) — no glyph
touches a neighbouring line.

### Ruling 2 — the two "Open Live Setu" buttons + baseline (user-authorized, SETTLED)

Kept, not reverted:
- `src/pages/products/setu/index.astro`: "Open Live Setu ↗" as `variant="primary" external`
  to https://app.orgs.social; "Explore Architecture ↓" as `secondary`; "Inquire About Setu"
  `secondary`.
- `src/pages/products/index.astro`: "Open Live Setu ↗" as `secondary external` to
  https://app.orgs.social in the Setu product card actions.
- `scripts/baseline/routes-and-text.json`: regenerated with the repo's own scanners
  (extractVisibleText / extractHrefs) for the two routes so verify:dist passes WITH the buttons
  present. This is an authorized baseline update, not a worked-around check.

Baseline diff vs HEAD (only these two routes change):
- `/products/` — hrefs: + "https://app.orgs.social"; text: + "Open Live Setu ↗".
- `/products/setu/` — hrefs: + "https://app.orgs.social"; text: + "Open Live Setu ↗".
  No hrefs removed, no title words changed.

The reviewer's rule treats any link/copy diff from HEAD as forbidden and is unaware of the user
authorization; its CHANGES_REQUESTED on the buttons is expected and is overridden by the explicit
user decision. These buttons/baseline entries are resolved-by-user-decision and must not be
reverted on future review passes.

### Setu inner-title line count — hard `<br>` removed (layout only)

The setu H1 "One record for every citizen, shared with consent — not copied." rendered 4 lines
@1440 (over the inner-title ≤3 rule) at every measure 18–34ch and every wrap mode, because a
hard `<br>` after "citizen," forced the break; the remainder then wrapped to 3 more lines.
Removing the `<br>` (and inserting a JSX `{' '}` so "citizen," and "shared" keep their space —
same pattern the home H1 uses) lets text-wrap:balance flow the title to 3 lines @1440. Same
words, same emphasis span — a layout change only, which the task permits ("move only the
emphasis spans" / the review already blessed a moved `<br>` on /products).
Re-measured setu H1: 360px = 4 lines, 768px = 3 lines, 1440px = 3 lines (≤3 @1440 ✓).

### Contrast pairs — no stale pair to remove

`scripts/contrast-pairs.json` has NO "gradient headline" / "headline phrase" pairs — the
committed HEAD already replaced the gradient-headline fill with solid `--color-text-brand`
emphasis and removed any gradient-headline pair in an earlier iteration. The only
`--accent-indigo-light` pair is "Home hero on mobile: badge text on the badge fill over the
dimmed scene", which is the live hero badge and must stay. The solid-emphasis pairs the current
markup relies on are present and measured:
- "brand text on page" — `--color-text-brand` on `--bg` = 7.88:1 (min 4.5) ✓
- "Home hero on mobile: solid brand emphasis phrase on the dimmed scene" —
  `--color-text-brand` on `color-mix(in srgb, var(--bg) 92%, var(--text))` = 6.44:1 (min 4.5) ✓
The file is unchanged vs HEAD (no stale pair existed to delete, no live pair removed).

## Files changed vs committed HEAD (final working tree)

| File | Change |
| --- | --- |
| `src/styles/tokens.css` | `--font-size-display-1` lowered to `clamp(38px, 2.41vw + 29.33px, 64px)` + comment |
| `src/pages/products/index.astro` | + "Open Live Setu ↗" secondary external button (user-authorized) |
| `src/pages/products/setu/index.astro` | + "Open Live Setu ↗" primary external button, CTA roles as approved; H1 hard `<br>` removed, `{' '}` space preserved |
| `scripts/baseline/routes-and-text.json` | regenerated text/hrefs for `/products/` and `/products/setu/` (authorized) |

`scripts/contrast-pairs.json` is NOT changed (already correct at HEAD).

## Checks run (in order, against the final on-disk tree)

| # | Command | Result |
| --- | --- | --- |
| 1 | `npm run check` | PASS — 0 errors, 0 warnings, 0 hints |
| 2 | `npm run build` | PASS — 10 pages built, Complete (vite >500 kB chunk notice is a pre-existing advisory) |
| 3 | `npm run test:logic` | PASS — pass 20, fail 0 |
| 4 | `npm run verify:source` | PASS — all 15 checks passed (phase 3) |
| 5 | `npm run verify:dist` | PASS — 14/14 checks passed, 0 vacuously, 0 failed (with the authorized buttons present) |

## Final display-token values shipped

```
--font-size-display-1: clamp(38px, 2.41vw + 29.33px, 64px);   /* 38px@360 → 64px@1440 (lowered from 72 to meet line-count rule) */
--font-size-display-2: clamp(34px, 2.41vw + 25.33px, 60px);   /* 34px@360 → 60px@1440 (unchanged) */
--font-size-display-3: clamp(26px, 1.48vw + 20.67px, 42px);   /* 26px@360 → ~42px@1440 (unchanged) */
--line-height-display-1: 1.08;  --letter-spacing-display-1: -0.02em;
--line-height-display-2: 1.12;  --letter-spacing-display-2: -0.015em;
--line-height-display-3: 1.2;   --letter-spacing-display-3: -0.01em;
font-weight: var(--font-weight-semibold);  /* 600 on every display rule */
```

## H1 line count × final computed font-size, per route (headless Chrome, built dist)

| Route | token | 360px | 768px | 1440px | fontPx 360 / 768 / 1440 |
| --- | --- | --- | --- | --- | --- |
| / | display-1 | 4 | 4 | 3 | 38.0 / 47.8 / 64.0 |
| /about | display-2 | 4 | 2 | 3 | 34.0 / 43.8 / 60.0 |
| /products | display-2 | 3 | 2 | 2 | 34.0 / 43.8 / 60.0 |
| /products/setu | display-2 | 4 | 3 | 3 | 34.0 / 43.8 / 60.0 |
| /products/field-book | display-2 | 4 | 3 | 3 | 34.0 / 43.8 / 60.0 |
| /contact | display-2 | 2 | 2 | 2 | 34.0 / 43.8 / 60.0 |
| /privacy | display-2 | 1 | 1 | 1 | 34.0 / 43.8 / 60.0 |
| /terms | display-2 | 1 | 1 | 1 | 34.0 / 43.8 / 60.0 |
| /signin | (page title) | 1 | 1 | 1 | 28.4 / 50.5 / 68.0 |
| /404 | display-2 | 1 | 1 | 1 | 34.0 / 43.8 / 60.0 |

Home H1 ≤3 @1440 and ≤4 @360 ✓. Every inner page title ≤3 @1440 ✓.
Descender/word checks: every multi-line headline and the stress string
"practical AI-powered gypsy jumpy" show a positive ink gap at all three widths (tightest +4px);
no glyph touches a neighbouring line or word.

## HeroPrism / frame statement

The current striped frame is handled in `src/components/scene/ScenePoster.astro` (hard hairline
removed, radial mask fading all four edges, flutes dimmed to internal texture), with a matching
radial mask on `.scene` in `src/components/scene/Scene3D.astro`. HeroPrism is NOT present in
`src/`; it exists only in `.kiro/specs/frontend-3d-upgrade/design.md`, and its retirement is a
Phase 3 concern. Confirmed: the current frame is handled in ScenePoster/Scene3D, not in HeroPrism.
