/**
 * Magnetic CTA registration (task 3.12).
 *
 * Elements with `data-magnetic` are pulled towards the pointer by at most {@link MAX_MAGNETIC_PX} on
 * each axis while a mouse or pen hovers them: `quickTo` on `x` and `y` (both composited), and they
 * ease back to 0 when the pointer leaves. Touch input never pulls.
 *
 * Runs only for `fullMotion && finePointer` (never under reduced motion); otherwise it is a no-op.
 * One AbortController owns every listener; cleanup aborts it and clears the inline transform.
 *
 * Takes the {@link MotionApi} facade instead of GSAP, so a recorder can stand in for it. Nothing here
 * touches `document` at import time, so Node can import this file.
 */
import type { MotionFlags, MotionSetup } from '../scroll/scroll-controller.ts';
import type { MotionApi, TweenVars } from './api.ts';
import { formatCubicBezier, parseCubicBezier, parseDurationToken, type CubicBezier } from './config.ts';

export const MAGNETIC_KEY = 'magnetic';
export const MAGNETIC_ATTRIBUTE = 'data-magnetic';
export const MAGNETIC_SELECTOR = `[${MAGNETIC_ATTRIBUTE}]`;
/** Largest pull on either axis, in px. */
export const MAX_MAGNETIC_PX = 6;

/** Used only if the root tokens cannot be read. They equal the tokens.css card values. */
const FALLBACK = {
  durationS: 0.35,
  ease: [0.22, 1, 0.36, 1] as CubicBezier,
} as const;

export interface MagneticOffset {
  readonly x: number;
  readonly y: number;
}

const clampUnit = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0);

/**
 * Maps a pointer position relative to the element centre (`nx`, `ny` in -1..1, right and down positive)
 * to a pull in px. Inputs outside -1..1 are clamped and non-finite inputs count as 0, so the result is
 * always within +-{@link MAX_MAGNETIC_PX}.
 */
export function magneticOffset(nx: number, ny: number): MagneticOffset {
  // `+ 0` turns -0 into 0.
  return { x: clampUnit(nx) * MAX_MAGNETIC_PX + 0, y: clampUnit(ny) * MAX_MAGNETIC_PX + 0 };
}

/** The registration only runs for full motion with a fine pointer. */
export function magneticEnabled(flags: MotionFlags): boolean {
  return flags.fullMotion && !flags.reduced && flags.finePointer;
}

interface Timing {
  readonly durationS: number;
  readonly ease: string;
}

function readTiming(doc: Document): Timing {
  const view = doc.defaultView;
  if (view === null) return { durationS: FALLBACK.durationS, ease: formatCubicBezier(FALLBACK.ease) };
  const style = view.getComputedStyle(doc.documentElement);
  return {
    durationS: parseDurationToken(style.getPropertyValue('--motion-duration-card')) ?? FALLBACK.durationS,
    ease: formatCubicBezier(parseCubicBezier(style.getPropertyValue('--ease-card')) ?? FALLBACK.ease),
  };
}

/** Mouse and pen only: a touch that happens on a hybrid device never pulls. */
const isFineInput = (event: PointerEvent): boolean => event.pointerType === 'mouse' || event.pointerType === 'pen';

export function magneticRegistration(api: MotionApi, doc: Document = document): MotionSetup {
  return (flags) => {
    if (!magneticEnabled(flags)) return;
    const targets = api.select(MAGNETIC_SELECTOR);
    if (targets.length === 0) return;

    const timing = readTiming(doc);
    const follow: TweenVars = { duration: timing.durationS, ease: timing.ease };
    const abort = new AbortController();
    const { signal } = abort;

    for (const element of targets) {
      const moveX = api.quickTo(element, 'x', follow);
      const moveY = api.quickTo(element, 'y', follow);

      element.addEventListener(
        'pointermove',
        (event) => {
          if (!isFineInput(event)) return;
          const width = element.offsetWidth;
          const height = element.offsetHeight;
          if (width === 0 || height === 0) return;
          const rect = element.getBoundingClientRect();
          const nx = (event.clientX - (rect.left + rect.width / 2)) / (width / 2);
          const ny = (event.clientY - (rect.top + rect.height / 2)) / (height / 2);
          const offset = magneticOffset(nx, ny);
          moveX(offset.x);
          moveY(offset.y);
        },
        { passive: true, signal },
      );

      element.addEventListener(
        'pointerleave',
        (event) => {
          if (!isFineInput(event)) return;
          moveX(0);
          moveY(0);
        },
        { signal },
      );
    }

    return () => {
      abort.abort();
      // overwrite: true also stops a pull still easing back when the preference flipped.
      api.set(targets, { clearProps: 'transform', overwrite: true });
    };
  };
}
