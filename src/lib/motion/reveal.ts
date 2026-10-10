/**
 * Reveal registration: elements fade (and, with full motion, rise) into view once, in batches.
 *
 * Takes the {@link MotionApi} facade instead of GSAP so a recorder can stand in for it. The selector
 * mirrors the CSS `animation-timeline: view()` reveal that this replaces, so pages need no edits.
 */
import type { MotionSetup } from '../scroll/scroll-controller.ts';
import type { MotionApi } from './api.ts';
import type { MotionTokens } from './config.ts';
import { planReveal } from './plan.ts';

export const REVEAL_SELECTOR = 'main :is(.section-heading, .glass-panel, .card), [data-reveal]';

export const REVEAL_KEY = 'reveal';

export function revealRegistration(api: MotionApi, tokens: () => MotionTokens): MotionSetup {
  return (flags) => {
    const items = api.select(REVEAL_SELECTOR);
    if (items.length === 0) {
      api.setMotionState('ready'); // nothing to hide, so do not let the failure timer fire
      return;
    }

    const plan = planReveal(flags, tokens());
    api.set(items, plan.from);
    api.batch(items, {
      start: plan.trigger.start,
      once: plan.trigger.once,
      // clearProps drops the inline transform once the rise ends, so it cannot override the CSS :hover
      // lift on cards that tilt does not own. The final opacity stays inline. Reduced motion never sets a
      // transform, so it stays fade-only.
      onEnter: (entered) => api.to(entered, { ...plan.to, overwrite: true, clearProps: 'transform' }),
    });
    // The inline styles now hold the hidden state, so the CSS pending rule can lift with no visible change.
    api.setMotionState('ready');

    // The context revert clears the inline styles; 'off' keeps the CSS rule from hiding anything again.
    return () => api.setMotionState('off');
  };
}
