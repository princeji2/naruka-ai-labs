/**
 * Page entry for the motion layer. Imported once by `BaseLayout.astro`.
 *
 * Registers the built-in effects, then binds the lifecycle gate to the Scroll_Controller: entering the
 * page runs `init()`, leaving it runs `destroy()`. The gate is idempotent, so repeated or interleaved
 * page events never create a second Lenis instance or leave triggers behind.
 *
 * Under the ClientRouter this module is evaluated once per session (the router does not re-run a
 * bundled module script it has already run), so the bindings below are made exactly once:
 * - first load: one enter (immediate or on DOMContentLoaded); the router's page-load event is not bound;
 * - `astro:before-swap`: leave (Lenis, ticker callback, ScrollTriggers and their scroll memory are
 *   released, scroll locks are dropped with the old page);
 * - `astro:after-swap`: enter against the new DOM (every registration re-queries its elements);
 * - `data-motion` is re-established as `pending` for the incoming page and the failure timer restarts.
 */
import { bindPageLifecycle, createGate } from '../lifecycle/page-lifecycle.ts';
import { scrollController } from '../scroll/index.ts';
import { registerBuiltInMotion } from './index.ts';
import { bindMotionGate } from './motion-gate.ts';

registerBuiltInMotion();

const gate = createGate(() => {
  scrollController.init();
  return () => {
    scrollController.destroy();
    // Locks taken by the page being left (for example the open nav drawer) must not stop the next page's Lenis.
    scrollController.releaseLocks();
  };
});

/** Removes the lifecycle listeners; kept for tests and hot reload. */
export const unbindMotionLifecycle: () => void = (() => {
  const unbindGate = bindPageLifecycle(gate, { document, window });
  const unbindMotionState = bindMotionGate({
    document,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  });
  return () => {
    unbindMotionState();
    unbindGate();
  };
})();
