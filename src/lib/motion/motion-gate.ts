/**
 * `data-motion` gate across ClientRouter swaps.
 *
 * The inline script in `BaseLayout.astro` sets `<html data-motion="pending">` and starts the 2.5 s
 * failure timer once, for the first load. On a client-side swap the router replaces every attribute of
 * `<html>` with the ones from the incoming document, and the incoming document has no `data-motion`
 * (the attribute is only ever added by script). Left alone, the new page would show its reveal targets
 * for a frame and then hide them, which is a flash.
 *
 * - `astro:before-swap`: mark the incoming document's root as `pending`. The router copies it over
 *   with the rest of the root attributes, so the new page starts hidden.
 * - `astro:after-swap`: restart the failure timer. If the motion layer has not taken over (state is
 *   still `pending`) when it fires, the state becomes `failed` and the content is shown.
 *
 * The timer is cleared on `astro:before-swap` and on unbind, so a stale timer from the previous page
 * can never flip the next page to `failed`. This module is bound once per session by `entry.ts`.
 */
import { MOTION_STATE_ATTRIBUTE } from './api.ts';

/** How long a page may stay `pending` before its content is shown anyway. Matches the inline script. */
export const MOTION_FAILURE_MS = 2500;

interface RootLike {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

export interface MotionGateTarget {
  readonly document: {
    readonly documentElement: RootLike;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  };
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

function incomingRoot(event: Event): RootLike | null {
  if (!('newDocument' in event)) return null;
  const next = event.newDocument as { documentElement?: RootLike } | null | undefined;
  return next?.documentElement ?? null;
}

/** Binds the gate to the router events. Returns an unbind function. */
export function bindMotionGate(target: MotionGateTarget): () => void {
  let timer: unknown = null;

  const stopTimer = (): void => {
    if (timer === null) return;
    target.clearTimeout(timer);
    timer = null;
  };

  const onBeforeSwap = (event: Event): void => {
    stopTimer();
    incomingRoot(event)?.setAttribute(MOTION_STATE_ATTRIBUTE, 'pending');
  };

  const onAfterSwap = (): void => {
    stopTimer();
    timer = target.setTimeout(() => {
      timer = null;
      const root = target.document.documentElement;
      if (root.getAttribute(MOTION_STATE_ATTRIBUTE) === 'pending') {
        root.setAttribute(MOTION_STATE_ATTRIBUTE, 'failed');
      }
    }, MOTION_FAILURE_MS);
  };

  target.document.addEventListener('astro:before-swap', onBeforeSwap);
  target.document.addEventListener('astro:after-swap', onAfterSwap);

  return () => {
    stopTimer();
    target.document.removeEventListener('astro:before-swap', onBeforeSwap);
    target.document.removeEventListener('astro:after-swap', onAfterSwap);
  };
}
