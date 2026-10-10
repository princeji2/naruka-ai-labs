/**
 * Reveal plan: a pure function from motion flags and tokens to the tween variables and trigger options.
 *
 * Full motion: opacity and `y`, with the token duration, ease and a batch stagger.
 * Reduced motion (or any state that is not full motion): opacity only, constant fade, no stagger.
 * Never `scrub`, never `pin`.
 */
import type { MotionFlags } from '../scroll/scroll-controller.ts';
import { formatCubicBezier, type MotionTokens } from './config.ts';

export type RevealFrom = { readonly opacity: number; readonly y?: number };

export type RevealTo = {
  readonly opacity: number;
  readonly y?: number;
  readonly duration: number;
  /** A CSS `cubic-bezier(...)` string; the GSAP implementation turns it into a CustomEase. */
  readonly ease: string;
  readonly stagger?: number;
};

export type RevealTrigger = {
  readonly start: string;
  readonly once: true;
  readonly scrub?: never;
  readonly pin?: never;
};

export interface RevealPlan {
  readonly from: RevealFrom;
  readonly to: RevealTo;
  readonly trigger: RevealTrigger;
}

export function planReveal(flags: MotionFlags, tokens: MotionTokens): RevealPlan {
  const ease = formatCubicBezier(tokens.ease);
  const trigger: RevealTrigger = { start: tokens.start, once: true };

  // Reduced motion wins if the flags disagree: fading is always safe, travel is not.
  if (flags.reduced || !flags.fullMotion) {
    return {
      from: { opacity: 0 },
      to: { opacity: 1, duration: tokens.reducedFadeS, ease },
      trigger,
    };
  }

  return {
    from: { opacity: 0, y: tokens.distancePx },
    to: { opacity: 1, y: 0, duration: tokens.durationS, ease, stagger: tokens.staggerS },
    trigger,
  };
}
