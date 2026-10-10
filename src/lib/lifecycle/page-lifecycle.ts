/**
 * Page lifecycle gate.
 *
 * `createGate` is a pure, idempotent enter/leave state machine. `bindPageLifecycle` wires it to
 * page events and returns a function that removes every listener it added.
 *
 * Events:
 * - DOMContentLoaded (or an immediate enter when the document is already parsed): first entry.
 * - pagehide: leave (real unload and bfcache entry).
 * - pageshow with `persisted`: enter (bfcache restore).
 * - astro:before-swap: leave, astro:after-swap: enter (ClientRouter, added in Phase 3). The first load
 *   under the router fires neither, so the initial entry comes only from the first bullet.
 *
 * The router's page-load event is deliberately NOT bound: under a router it also fires on the first load,
 * right after the initial enter, which would duplicate the entry.
 */

export type Cleanup = () => void;
export type Setup = () => void | Cleanup;

export interface Gate {
  /** Runs setup once; a no-op while active. */
  enter(): void;
  /** Runs the cleanup once; a no-op while inactive. */
  leave(): void;
  readonly active: boolean;
}

export function createGate(setup: Setup): Gate {
  let cleanup: Cleanup | null = null;
  let active = false;
  return {
    enter() {
      if (active) return;
      active = true;
      cleanup = setup() ?? null;
    },
    leave() {
      if (!active) return;
      active = false;
      const run = cleanup;
      cleanup = null;
      run?.();
    },
    get active() {
      return active;
    },
  };
}

export interface LifecycleTarget {
  readonly document: Pick<Document, 'readyState' | 'addEventListener' | 'removeEventListener'>;
  readonly window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

function isPersisted(event: Event): boolean {
  return 'persisted' in event && event.persisted === true;
}

/** Binds a gate to page events. Returns an unbind function that removes every listener added here. */
export function bindPageLifecycle(gate: Gate, target: LifecycleTarget): () => void {
  const enter = (): void => gate.enter();
  const leave = (): void => gate.leave();
  const onPageShow = (event: Event): void => {
    if (isPersisted(event)) gate.enter();
  };

  if (target.document.readyState === 'loading') {
    target.document.addEventListener('DOMContentLoaded', enter, { once: true });
  } else {
    gate.enter();
  }
  target.window.addEventListener('pagehide', leave);
  target.window.addEventListener('pageshow', onPageShow);
  // Router events. `document` survives a swap, so these are bound once per session; the page DOM does not,
  // which is why enter must re-query it.
  target.document.addEventListener('astro:before-swap', leave);
  target.document.addEventListener('astro:after-swap', enter);

  return () => {
    target.document.removeEventListener('DOMContentLoaded', enter);
    target.window.removeEventListener('pagehide', leave);
    target.window.removeEventListener('pageshow', onPageShow);
    target.document.removeEventListener('astro:before-swap', leave);
    target.document.removeEventListener('astro:after-swap', enter);
  };
}
