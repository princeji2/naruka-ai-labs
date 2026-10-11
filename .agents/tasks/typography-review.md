# Editorial display typography, de-framed hero, quieter network — with a working-tree regression that re-adds forbidden links

The typography work on the committed branch tip (`99ce242`) is sound and matches the task on every substantive point: the three display tokens are re-tuned to the target clamps, weight drops to 600, tracking and leading are loosened to the specified values, every headline gradient fill is replaced by a single solid `--color-text-brand` emphasis phrase, the hero poster is de-framed with a radial mask, and the background network is quieted by ~1/3. The prior review's two findings were both addressed *in that commit*. The problem is not the typography — it is that the **current working tree no longer matches the state the verification evidence was gathered against.** Uncommitted edits re-introduce the exact `Open Live Setu ↗` / `https://app.orgs.social` link additions and the setu CTA role-reversal that iteration 1 flagged as BLOCKING, regenerate `scripts/baseline/routes-and-text.json` to legitimize them, and delete the correct solid-brand emphasis contrast pair that HEAD had added.

Watch for:
- **confirmed** — The working tree re-adds `Open Live Setu ↗` buttons linking `https://app.orgs.social` on `/products` and `/products/setu`, and reverses the setu primary/secondary CTA roles. These are link additions the task forbids. `git show HEAD` confirms the committed tip does NOT contain them; the additions live only in uncommitted working-tree changes.
- **confirmed** — The working tree regenerates `scripts/baseline/routes-and-text.json` (adds 3 `app.orgs.social` entries) so `verify:dist` would pass with the new links present. That is "working around a failing check," which the task explicitly forbids.
- **confirmed** — The recorded `verify:dist` 14/14 PASS was produced against the clean committed HEAD, not against the current working tree. Re-running `verify:dist` on the working tree as it stands would fail the "Links preserved" / "Copy preserved" checks (the 12/14 state iteration 1 saw).
- **confirmed** — The working tree deletes the accurate "solid brand emphasis phrase on the dimmed scene" contrast pair from `scripts/contrast-pairs.json` that HEAD added, re-opening the iteration-1 cleanup finding.

**Verdict**: NEEDS_CHANGES

## High-level view

The committed display tokens are correct. `--font-size-display-1` is `clamp(40px, 2.96vw + 29.33px, 72px)` (40px@360 → ~72px@1440), display-2 `clamp(34px, 2.41vw + 25.33px, 60px)`, display-3 `clamp(26px, 1.48vw + 20.67px, 42px)`. Line-heights are 1.08/1.12/1.2 and letter-spacing −0.02/−0.015/−0.01em — never tighter than spec. Weight is `--font-weight-semibold` (600) on every display rule. Still exactly three display tokens; no colour token was touched.

Every headline gradient fill is gone. Home, about, contact, products, setu, and field-book each now wrap one short phrase in `.headline-emphasis { color: var(--color-text-brand) }` and leave the rest of the headline at `--text`. The gradient utilities (`text-gradient-emerald`, `text-gradient-amber`) were removed from the two product detail pages. Copy words are unchanged on every page except `/products`, where the author moved a `<br>` and shifted the emphasis span from "built for real workflows" to "real workflows" — same words, re-balanced across two lines, which the task permits ("move only the emphasis spans").

The hero is de-framed at the source: `ScenePoster.astro` drops the hard top hairline, swaps its bottom-only linear mask for a radial mask that fades all four edges, and dims the flutes to internal texture (opacity 0.6→0.25); `Scene3D.astro` adds the same radial mask over the canvas layer so neither poster nor live scene shows a rectangle. The background network drops `densityValue` 140→93 and `linkOpacity` 0.4→0.27 (~1/3 each) via the existing numeric config, no new colours. Page-header rhythm is normalized across inner pages: `gap: var(--space-xl)` for badge→H1→lead, lead at `--color-text-secondary`, line-height 1.6, max-width 60ch.

None of that is the problem. The problem is delivery state. The branch tip is clean, but the working tree on disk — the thing that actually builds and verifies — carries uncommitted changes that undo the iteration-1 fix, regenerate the baseline to hide it, and remove the correct contrast pair. The verification note describes the HEAD state as if it were the shipped state; it is not. Until the working tree is reconciled to the committed HEAD (or the links are properly reverted and the baseline/contrast-pairs restored), the gate cannot pass honestly.

<details>
<summary>Issues (4)</summary>

1. **Forbidden links re-added in working tree** — `src/pages/products/index.astro` and `src/pages/products/setu/index.astro` carry uncommitted `Open Live Setu ↗` buttons to `https://app.orgs.social`, plus a setu CTA primary/secondary role swap. Revert both files to their committed HEAD (`99ce242`) state so no new links/copy exist.
2. **Baseline regenerated to mask the links** — `scripts/baseline/routes-and-text.json` has uncommitted edits adding `app.orgs.social` entries so `verify:dist` passes with the new links. Restore it to HEAD; do not regenerate the baseline to accommodate unauthorized links (the task forbids working around a failing check).
3. **Correct contrast pair deleted** — the working tree removes the "solid brand emphasis phrase on the dimmed scene" pair HEAD added to `scripts/contrast-pairs.json`. Restore the file to HEAD so the shipped emphasis treatment stays declared and measured.
4. **Verification evidence does not match the shipped tree** — the recorded 14/14 `verify:dist` PASS was taken against clean HEAD, not the current working tree. After reverting items 1–3, re-run `verify:dist` and confirm it passes against the actual tree on disk.

</details>

<details>
<summary>Details</summary>

### Display tokens (committed state is correct)

`src/styles/tokens.css` ships exactly three display size tokens and no colour-token edits:

```
--font-size-display-1: clamp(40px, 2.96vw + 29.33px, 72px);   /* 40px@360 → ~72px@1440 */
--font-size-display-2: clamp(34px, 2.41vw + 25.33px, 60px);   /* 34 → 60 */
--font-size-display-3: clamp(26px, 1.48vw + 20.67px, 42px);   /* 26 → ~42 */
--line-height-display-1: 1.08;  --letter-spacing-display-1: -0.02em;
--line-height-display-2: 1.12;  --letter-spacing-display-2: -0.015em;
--line-height-display-3: 1.2;   --letter-spacing-display-3: -0.01em;
```

Every target is hit: display-1 at the 72/40 bound, display-2 inside 56–64 at 60, display-3 inside 40–44 at ~42; leading and tracking exactly as specified and never tighter. Weight 600 is applied as `font-weight: var(--font-weight-semibold)` on each `.hero-title`, `.*-title`, and `.section-title` rule; the old 0.95/1.0/1.1 leading and −0.03em tracking are gone. This is the calm editorial scale the task asked for.

### Gradient removal and single-phrase emphasis

The old `text-gradient-brand` / `text-gradient-emerald` / `text-gradient-amber` headline fills are replaced everywhere by `.headline-emphasis { color: var(--color-text-brand) }`, applied to one phrase per headline (≤3 words): "practical AI-powered software" (home — 3 words), "transparent principles" (about), "Naruka AI Labs" (contact), "real workflows" (products), "shared with consent" (setu), "verified credentialing" (field-book). The two product pages also delete the now-unused gradient utility blocks. `--color-text-brand` is an existing token reference, not a new colour. The `/products` headline moved its `<br>` and emphasis span but kept the same words, which the task permits.

### Hero de-framing

The visible striped rectangle came from `ScenePoster.astro` — the author states this explicitly in the file header comment. The fix removes `.poster-hairline` entirely, replaces the bottom-only linear mask with `radial-gradient(ellipse 72% 72% at 50% 42%, …, transparent 100%)` so all four edges dissolve, and drops flute opacity 0.6→0.25 with lower-contrast stops so the flutes read as faint internal texture rather than a box. `Scene3D.astro` adds a matching radial mask on `.scene` so the live canvas has no rectangular edge either. The scene markup is otherwise intact, so the visual stays functional. The HeroPrism/Phase-3 statement the task asked for is present in the verification note.

### Background network quieting

`DESKTOP_CONFIG` in `src/lib/background/particle-field.ts` drops `densityValue` 140→93 and `linkOpacity` 0.4→0.27 — each ~1/3 down — through the existing numeric config with no new colours, matching the request. The dimmed-scene scrim pairs in `contrast-pairs.json` (lead, location tag, pill meta) remain and are measured ≥4.5:1 per the note, so text stays off the lines. `prefers-reduced-motion` handling in `ScenePoster.astro` is preserved.

### Page-header rhythm

About, contact, products, 404, privacy, terms, setu, and field-book all converge on the same pattern: header container `gap: var(--space-xl)` (~24px) for badge→H1→lead, lead at `--color-text-secondary`, `line-height: 1.6`, `max-width: 60ch`, with `text-wrap: balance` and a ~18–22ch measure on titles. Contact adds `margin-bottom: var(--space-3xl)` for the lead→content gap. This is consistent and matches the spec.

### The working-tree regression (blocking)

`git status` shows four files modified but uncommitted: `src/pages/products/index.astro`, `src/pages/products/setu/index.astro`, `scripts/baseline/routes-and-text.json`, `scripts/contrast-pairs.json`. Reading the files on disk versus `git show HEAD:`:

- **setu** — HEAD has only `Explore Architecture ↓` as `variant="primary"` and no `app.orgs.social`. The working tree re-adds `Open Live Setu ↗` as `variant="primary" external` and demotes `Explore Architecture ↓` to `secondary` — the precise role-reversal iteration 1 flagged.
- **products** — HEAD has no `Open Live Setu` button. The working tree re-adds it as a `secondary external` button to `https://app.orgs.social`.
- **routes-and-text.json** — working tree adds 3 `app.orgs.social` entries versus HEAD, i.e. the link baseline was regenerated to make the new links pass `verify:dist`.
- **contrast-pairs.json** — working tree *removes* the "solid brand emphasis phrase on the dimmed scene" pair that HEAD added, re-opening the iteration-1 cleanup item.

The verification note records `verify:dist` 14/14 PASS and `verify:source` all-pass. Those runs reflect the committed HEAD, which is clean. They do not reflect the current working tree. Against the tree as it stands, `verify:dist` "Links preserved" / "Copy preserved" would fail (the 12/14 state the prior pass saw) unless the regenerated baseline is accepted — and accepting a baseline regenerated to legitimize unauthorized links is itself the "work around a failing check" the task forbids. The deliverable must be reconciled: revert all four files to HEAD so the shipped tree equals the verified, compliant state, then re-run `verify:dist` to confirm.

### Unrelated bundled change (non-blocking, pre-existing)

`src/components/Badge.astro` moves casing from scoped classes to an inline `style` to survive Astro's scoped-CSS tree-shaking. This belongs to the earlier Phase 5 commit (`7ea9ce6`), not the typography commit (`99ce242`), so it is out of scope for this review and not a typography concern.

</details>

<details>
<summary>File map</summary>

- `src/styles/tokens.css` — three display tokens re-tuned (size/leading/tracking/weight); no colour tokens touched.
- `src/pages/index.astro` — hero emphasis → solid brand, section titles weight 600, measure/balance, lead 60ch/1.6.
- `src/pages/about|contact/index.astro` — gradient→brand emphasis, header rhythm `space-xl`, lead 60ch/1.6.
- `src/pages/products/field-book/index.astro` — removed `text-gradient-amber`, solid emphasis, measure/leading.
- `src/pages/products/index.astro` — solid emphasis + header rhythm; **working tree also re-adds forbidden `Open Live Setu` link (revert).**
- `src/pages/products/setu/index.astro` — removed `text-gradient-emerald`, solid emphasis; **working tree re-adds `Open Live Setu` primary link + CTA role swap (revert).**
- `src/pages/404|privacy|terms/index.astro` — title weight 600, balance, measure; lead 60ch/1.6 (404).
- `src/components/scene/ScenePoster.astro` — removed hairline, radial edge mask, dimmed flutes (de-frame source).
- `src/components/scene/Scene3D.astro` — radial mask on `.scene` so canvas has no rectangle.
- `src/lib/background/particle-field.ts` — density 140→93, linkOpacity 0.4→0.27 (~1/3 each).
- `scripts/contrast-pairs.json` — HEAD adds correct solid-brand pair; **working tree deletes it (restore).**
- `scripts/baseline/routes-and-text.json` — **working tree regenerated to add `app.orgs.social` (restore to HEAD).**
- `src/components/Badge.astro` — inline casing; out of scope (Phase 5 commit).

Full diff: `git diff main` (committed) and `git diff` (uncommitted working-tree regression).

</details>
