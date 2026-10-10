/**
 * Parallax registration (design section 3.7).
 *
 * Elements with `data-parallax="0.15"` get a scrubbed `yPercent` tween while they cross the viewport:
 * the value is the fraction of the element's own height it travels in total, centred on its resting
 * position, so it starts `amount / 2` below and ends `amount / 2` above. `yPercent` is a transform, so
 * nothing here touches layout.
 *
 * Runs only for `desktop && fullMotion` (and never under reduced motion). This is the only family of
 * scrubbed tweens and none of them is pinned. A missing, non-numeric or non-positive value is ignored.
 *
 * Takes the {@link MotionApi} facade instead of GSAP, so a recorder can stand in for it. Nothing here
 * touches `document` at import time, so Node can import this file.
 */
import type { MotionFlags, MotionSetup } from '../scroll/scroll-controller.ts';
import type { MotionApi } from './api.ts';

export const PARALLAX_KEY = 'parallax';
export const PARALLAX_ATTRIBUTE = 'data-parallax';
export const PARALLAX_SELECTOR = `[${PARALLAX_ATTRIBUTE}]`;
/** The element's top edge enters the viewport bottom until its bottom edge leaves the top. */
export const PARALLAX_START = 'top bottom';
export const PARALLAX_END = 'bottom top';
/** Upper bound on the travel, as a fraction of the element's height, so a typo cannot fling an element away. */
export const MAX_PARALLAX = 0.5;

/** The registration only runs for full motion at desktop width. */
export function parallaxEnabled(flags: MotionFlags): boolean {
  return flags.fullMotion && !flags.reduced && flags.desktop;
}

/** Parses a `data-parallax` value. Returns `null` unless it is a finite number above 0; clamps to {@link MAX_PARALLAX}. */
export function parseParallaxAmount(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.min(MAX_PARALLAX, amount);
}

export function parallaxRegistration(api: MotionApi): MotionSetup {
  return (flags) => {
    if (!parallaxEnabled(flags)) return;
    for (const element of api.select(PARALLAX_SELECTOR)) {
      const amount = parseParallaxAmount(element.getAttribute(PARALLAX_ATTRIBUTE));
      if (amount === null) continue;
      const half = (amount * 100) / 2;
      api.scrubFromTo(
        [element],
        { yPercent: half },
        { yPercent: -half },
        { trigger: element, start: PARALLAX_START, end: PARALLAX_END, scrub: true },
      );
    }
    // The matchMedia context reverts the tweens and their triggers, which also clears the inline transform.
  };
}
