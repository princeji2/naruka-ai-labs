/**
 * Motion facade: types and pure helpers only, no value import of `gsap`.
 *
 * Registrations talk to {@link MotionApi} instead of GSAP, so tests can run every registration against
 * a recorder and assert what it would animate. `./real-api.ts` is the GSAP/ScrollTrigger implementation.
 */
import { findNonComposited } from './guard.ts';

export type TweenVars = Readonly<Record<string, unknown>>;

/** Values of the `data-motion` attribute on `<html>`. */
export type MotionState = 'pending' | 'ready' | 'failed' | 'off';

export const MOTION_STATE_ATTRIBUTE = 'data-motion';

export interface TriggerOptions {
  readonly trigger?: Element | string;
  readonly start?: string;
  readonly end?: string;
  readonly once?: boolean;
  readonly scrub?: boolean | number;
  readonly pin?: boolean | Element | string;
  readonly onToggle?: (active: boolean) => void;
  readonly onEnter?: (targets: Element[]) => void;
  /** Called on every scroll update of the trigger with its progress in 0..1. */
  readonly onUpdate?: (progress: number) => void;
}

/** Trigger options for a scrubbed tween: `pin` and the callbacks make no sense there and are not accepted. */
export type ScrubOptions = Pick<TriggerOptions, 'trigger' | 'start' | 'end' | 'scrub'>;

export interface MotionApi {
  select(selector: string): HTMLElement[];
  set(targets: Element[], vars: TweenVars): void;
  to(targets: Element[], vars: TweenVars): void;
  fromTo(targets: Element[], from: TweenVars, to: TweenVars): void;
  quickTo(target: Element, prop: string, vars: TweenVars): (value: number) => void;
  /**
   * A tween scrubbed by its own ScrollTrigger (linear ease, progress follows the scroll position).
   * `from` and `to` go through the composited-only guard like every other tween. No pin.
   */
  scrubFromTo(targets: Element[], from: TweenVars, to: TweenVars, options: ScrubOptions): void;
  /** A single ScrollTrigger. */
  trigger(options: TriggerOptions): void;
  /** `ScrollTrigger.batch`: one trigger group for many targets; `onEnter` receives the targets that entered together. */
  batch(targets: Element[], options: TriggerOptions): void;
  setMotionState(state: MotionState): void;
}

/** Thrown in development when a tween asks for a property that is not composited. */
export class NonCompositedTweenError extends Error {
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(`Non-composited tween properties are not allowed: ${keys.join(', ')}`);
    this.name = 'NonCompositedTweenError';
    this.keys = keys;
  }
}

/**
 * Applies the composited-only guard to tween variables.
 * With `strict` (development) a non-composited key throws, so the mistake is loud.
 * Without it the offending keys are dropped, so a layout property can never reach GSAP in production.
 */
export function guardTweenVars(vars: TweenVars, strict: boolean): Record<string, unknown> {
  const rejected = findNonComposited(vars);
  if (rejected.length === 0) return { ...vars };
  if (strict) throw new NonCompositedTweenError(rejected);
  const blocked = new Set(rejected);
  return Object.fromEntries(Object.entries(vars).filter(([key]) => !blocked.has(key)));
}
