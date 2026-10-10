/**
 * Runs a callback when the main thread is idle, at the latest after `timeoutMs`. Returns a cancel
 * function (idempotent; safe to call after the callback ran).
 *
 * Uses `requestIdleCallback` when the host has it. Safari does not, so the fallback is a short
 * `setTimeout` (at most {@link FALLBACK_DELAY_MS}, and never longer than `timeoutMs`).
 */

/** The scheduling functions this module needs. `globalThis` satisfies it. */
export interface IdleHost {
  requestIdleCallback?(callback: () => void, options?: { timeout: number }): number;
  cancelIdleCallback?(handle: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export const FALLBACK_DELAY_MS = 200;

export function whenIdle(callback: () => void, timeoutMs: number, host: IdleHost = globalThis): () => void {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  let done = false;

  const run = (): void => {
    if (done) return;
    done = true;
    callback();
  };

  if (typeof host.requestIdleCallback === 'function' && typeof host.cancelIdleCallback === 'function') {
    const handle = host.requestIdleCallback(run, { timeout });
    return () => {
      if (done) return;
      done = true;
      host.cancelIdleCallback?.(handle);
    };
  }

  const handle = host.setTimeout(run, Math.min(timeout, FALLBACK_DELAY_MS));
  return () => {
    if (done) return;
    done = true;
    host.clearTimeout(handle);
  };
}
