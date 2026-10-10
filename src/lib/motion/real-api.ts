/**
 * GSAP/ScrollTrigger implementation of {@link MotionApi}.
 *
 * Every tween (`set`, `to`, `fromTo`, `quickTo`) goes through the composited-only guard first: in
 * development a non-composited key throws, in production it is dropped. Plugins are registered by the
 * Scroll_Controller (`../scroll/index.ts`) before any registration runs, so this file does not register them.
 */
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  guardTweenVars,
  MOTION_STATE_ATTRIBUTE,
  type MotionApi,
  type MotionState,
  type TriggerOptions,
  type TweenVars,
} from './api.ts';
import { parseCubicBezier } from './config.ts';

const easeCache = new Map<string, gsap.EaseFunction>();

/** Turns a CSS `cubic-bezier(...)` string into a CustomEase; other ease values pass through to GSAP. */
function resolveEase(ease: string): string | gsap.EaseFunction {
  const bezier = parseCubicBezier(ease);
  if (bezier === null) return ease;
  const id = `naruka-${bezier.join('-')}`;
  const cached = easeCache.get(id);
  if (cached !== undefined) return cached;
  const created = CustomEase.create(id, bezier.join(','));
  easeCache.set(id, created);
  return created;
}

/** Guard, then resolve the ease. Everything that reaches GSAP passes through here. */
function prepare(vars: TweenVars): Record<string, unknown> {
  const safe = guardTweenVars(vars, import.meta.env.DEV);
  const ease = safe.ease;
  return typeof ease === 'string' ? { ...safe, ease: resolveEase(ease) } : safe;
}

function triggerVars(options: TriggerOptions): ScrollTrigger.Vars {
  const vars: ScrollTrigger.Vars = {};
  if (options.trigger !== undefined) vars.trigger = options.trigger;
  if (options.start !== undefined) vars.start = options.start;
  if (options.end !== undefined) vars.end = options.end;
  if (options.once !== undefined) vars.once = options.once;
  if (options.scrub !== undefined) vars.scrub = options.scrub;
  if (options.pin !== undefined) vars.pin = options.pin;
  const { onToggle } = options;
  if (onToggle !== undefined) vars.onToggle = (self) => onToggle(self.isActive);
  const { onUpdate } = options;
  if (onUpdate !== undefined) vars.onUpdate = (self) => onUpdate(self.progress);
  return vars;
}

export const realMotionApi: MotionApi = {
  select(selector) {
    return Array.from(document.querySelectorAll<HTMLElement>(selector));
  },

  set(targets, vars) {
    gsap.set(targets, prepare(vars));
  },

  to(targets, vars) {
    gsap.to(targets, prepare(vars));
  },

  fromTo(targets, from, to) {
    gsap.fromTo(targets, prepare(from), prepare(to));
  },

  scrubFromTo(targets, from, to, options) {
    // Both ends go through the guard. The trigger is built from the scrub-safe subset only (no pin, no callbacks).
    const { trigger, start, end, scrub } = options;
    const scrollTrigger = triggerVars({
      ...(trigger !== undefined ? { trigger } : {}),
      ...(start !== undefined ? { start } : {}),
      ...(end !== undefined ? { end } : {}),
      scrub: scrub ?? true,
    });
    gsap.fromTo(targets, prepare(from), { ...prepare(to), ease: 'none', scrollTrigger });
  },

  quickTo(target, prop, vars) {
    // The property and the tween options both go through the guard.
    guardTweenVars({ [prop]: 0 }, import.meta.env.DEV);
    const setter = gsap.quickTo(target, prop, prepare(vars));
    return (value) => {
      setter(value);
    };
  },

  trigger(options) {
    const { onEnter, trigger } = options;
    const vars = triggerVars(options);
    if (onEnter !== undefined) {
      vars.onEnter = () => {
        if (trigger === undefined) onEnter([]);
        else if (typeof trigger === 'string') onEnter(Array.from(document.querySelectorAll(trigger)));
        else onEnter([trigger]);
      };
    }
    ScrollTrigger.create(vars);
  },

  batch(targets, options) {
    const { onEnter } = options;
    // Batches only use the start/end/once options; scrub and pin make no sense for a group of reveals.
    ScrollTrigger.batch(targets, {
      ...(options.start !== undefined ? { start: options.start } : {}),
      ...(options.end !== undefined ? { end: options.end } : {}),
      ...(options.once !== undefined ? { once: options.once } : {}),
      ...(onEnter !== undefined ? { onEnter: (entered: Element[]) => onEnter(entered) } : {}),
    });
  },

  setMotionState(state: MotionState) {
    document.documentElement.setAttribute(MOTION_STATE_ATTRIBUTE, state);
  },
};
