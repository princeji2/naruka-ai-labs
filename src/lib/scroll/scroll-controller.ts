/**
 * Scroll_Controller: dependency-injected core.
 *
 * Owns the single Lenis instance, drives it from the GSAP ticker, keeps ScrollTrigger in sync, and
 * runs every registered motion effect inside its own `gsap.matchMedia()` context so GSAP reverts
 * tweens and ScrollTriggers when the motion preferences change or the controller is destroyed.
 *
 * This file has no value imports of `gsap`, `lenis` or `three` and never touches `window`,
 * `document` or `import.meta`, so Node can import it. The real wiring lives in `./index.ts`.
 */

export interface LenisLike {
  on(event: 'scroll', callback: () => void): unknown;
  raf(timeMs: number): void;
  start(): void;
  stop(): void;
  destroy(): void;
}

export interface TickerLike {
  add(callback: (timeSeconds: number) => void): unknown;
  remove(callback: (timeSeconds: number) => void): unknown;
  lagSmoothing(threshold: number, adjustedLag?: number): unknown;
}

export interface TriggerLike {
  kill(revert?: boolean): void;
}

export interface ScrollTriggerLike {
  update(): void;
  refresh(): void;
  getAll(): TriggerLike[];
  /**
   * Forgets the recorded scroll positions ScrollTrigger uses to restore on refresh, so a page swapped in
   * by the router does not inherit the previous page's positions. Called on every destroy.
   */
  clearScrollMemory?(): void;
}

export type Conditions = Readonly<Record<string, boolean>>;

export interface MatchMediaLike {
  add(
    queries: Readonly<Record<string, string>>,
    setup: (context: { conditions?: Conditions }) => void | (() => void),
  ): unknown;
  /**
   * GSAP's `MatchMedia.kill(revert)` runs the cleanup functions returned from `add` callbacks (and reverts
   * the tweens) only when `revert` is truthy; a plain `kill()` just kills tweens and leaves them behind.
   */
  kill(revert?: boolean): void;
}

export interface ScrollControllerDeps {
  /** Registers ScrollTrigger (and CustomEase) with GSAP. Guarded so it takes effect once per module. */
  registerPlugins(): void;
  createLenis(): LenisLike;
  createMatchMedia(): MatchMediaLike;
  ticker: TickerLike;
  scrollTrigger: ScrollTriggerLike;
  /** Resolves when web fonts have loaded; the controller then refreshes ScrollTrigger once. */
  fontsReady?: () => Promise<unknown>;
  /** Receives errors the controller contains (Lenis creation, a throwing registration). */
  onError?: (scope: string, error: unknown) => void;
}

/** Media queries behind {@link MotionFlags}. Mobile is below 768 px, matching the Navbar breakpoint. */
export const MOTION_QUERIES = {
  fullMotion: '(prefers-reduced-motion: no-preference)',
  reduced: '(prefers-reduced-motion: reduce)',
  mobile: '(max-width: 767.98px)',
  desktop: '(min-width: 768px)',
  finePointer: '(hover: hover) and (pointer: fine)',
} as const;

export interface MotionFlags {
  /** prefers-reduced-motion: no-preference */
  readonly fullMotion: boolean;
  /** prefers-reduced-motion: reduce */
  readonly reduced: boolean;
  /** width < 768 */
  readonly mobile: boolean;
  /** width >= 768 */
  readonly desktop: boolean;
  /** (hover: hover) and (pointer: fine) */
  readonly finePointer: boolean;
}

export type MotionSetup = (flags: MotionFlags) => void | (() => void);

export interface ScrollControllerStats {
  /** Lenis instances created and not yet destroyed. */
  readonly lenis: number;
  /** GSAP ticker callbacks added by the controller and not yet removed. */
  readonly tickerCallbacks: number;
}

export interface ScrollController {
  /** Idempotent: a second call while running changes nothing. */
  init(): void;
  /** Idempotent: a call while stopped changes nothing. */
  destroy(): void;
  /** Registers a motion effect. Survives destroy/init cycles. The same key replaces the earlier setup. */
  register(key: string, setup: MotionSetup): void;
  /**
   * Drops every held scroll lock. Used when the page that took the locks is gone (router leave, unload),
   * so a lock owned by removed DOM cannot keep the next page's Lenis stopped. Each release function
   * returned by `lock` stays safe to call afterwards (it becomes a no-op).
   */
  releaseLocks(): void;
  /** Ref-counted scroll lock. Lenis is stopped iff at least one lock is held. Release is idempotent. */
  lock(reason: string): () => void;
  readonly running: boolean;
  readonly stats: ScrollControllerStats;
}

const FULL_MOTION_ONLY: Readonly<Record<string, string>> = {
  fullMotion: MOTION_QUERIES.fullMotion,
};

function toFlags(conditions: Conditions | undefined): MotionFlags {
  return {
    fullMotion: conditions?.fullMotion === true,
    reduced: conditions?.reduced === true,
    mobile: conditions?.mobile === true,
    desktop: conditions?.desktop === true,
    finePointer: conditions?.finePointer === true,
  };
}

export function createScrollController(deps: ScrollControllerDeps): ScrollController {
  const registrations = new Map<string, MotionSetup>();
  /** Held locks. The Symbol is the identity, the reason is kept for debugging only. */
  const locks = new Map<symbol, string>();
  /** Teardown functions of Lenis instances that are alive right now (idempotent each). */
  const liveInstances = new Set<() => void>();

  let matchMedia: MatchMediaLike | null = null;
  let lenis: LenisLike | null = null;
  let generation = 0;
  let lenisCount = 0;
  let tickerCount = 0;

  const report = (scope: string, error: unknown): void => {
    deps.onError?.(scope, error);
  };

  /** Rule: Lenis is stopped iff the lock set is non-empty. */
  const applyLock = (): void => {
    if (lenis === null) return;
    if (locks.size > 0) lenis.stop();
    else lenis.start();
  };

  const startLenisContext = (mm: MatchMediaLike): void => {
    mm.add(FULL_MOTION_ONLY, (context) => {
      // Reduced motion: no Lenis, native scrolling (R7.4). The context re-runs on a live preference change (R7.5).
      if (context.conditions?.fullMotion !== true) return;

      let instance: LenisLike;
      try {
        instance = deps.createLenis();
      } catch (error) {
        // Native scrolling stays; registered effects still run in their own contexts.
        report('lenis', error);
        return;
      }
      lenisCount += 1;

      const tick = (timeSeconds: number): void => instance.raf(timeSeconds * 1000);
      instance.on('scroll', () => deps.scrollTrigger.update());
      deps.ticker.add(tick);
      tickerCount += 1;
      deps.ticker.lagSmoothing(0);
      lenis = instance;
      applyLock();

      let disposed = false;
      const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        liveInstances.delete(dispose);
        deps.ticker.remove(tick);
        tickerCount -= 1;
        deps.ticker.lagSmoothing(500, 33); // GSAP defaults
        instance.destroy();
        lenisCount -= 1;
        if (lenis === instance) lenis = null;
      };
      liveInstances.add(dispose);
      return dispose;
    });
  };

  const addRegistration = (mm: MatchMediaLike, key: string, setup: MotionSetup): void => {
    mm.add(MOTION_QUERIES, (context) => {
      try {
        return setup(toFlags(context.conditions));
      } catch (error) {
        report(`register:${key}`, error);
        return undefined;
      }
    });
  };

  const init = (): void => {
    if (matchMedia !== null) return; // second init leaves exactly one instance (R6.7)
    deps.registerPlugins(); // once (R6.2)
    generation += 1;
    const mm = deps.createMatchMedia();
    matchMedia = mm;

    startLenisContext(mm);
    for (const [key, setup] of registrations) addRegistration(mm, key, setup);

    // Web fonts change layout after first paint; re-measure once, unless we were torn down meanwhile.
    const initGeneration = generation;
    const fontsReady = deps.fontsReady?.();
    if (fontsReady !== undefined) {
      fontsReady.then(
        () => {
          if (matchMedia !== null && generation === initGeneration) deps.scrollTrigger.refresh();
        },
        (error: unknown) => report('fonts', error),
      );
    }
  };

  const destroy = (): void => {
    if (matchMedia === null) return;
    const mm = matchMedia;
    matchMedia = null;
    generation += 1; // invalidates a pending fonts refresh
    mm.kill(true); // `true` is what makes GSAP run every registration's cleanup (listeners, attributes) and revert its tweens
    for (const dispose of [...liveInstances]) dispose(); // backstop if a cleanup did not run
    for (const trigger of deps.scrollTrigger.getAll()) trigger.kill(); // backstop for anything created outside a context (R6.5)
    deps.scrollTrigger.clearScrollMemory?.(); // the next page starts from the browser's scroll position
    lenis = null;
  };

  return {
    init,
    destroy,
    register(key, setup) {
      const replacing = registrations.has(key);
      registrations.set(key, setup);
      if (matchMedia === null) return;
      if (replacing) {
        // A matchMedia context cannot be removed individually, so rebuild to avoid running the old setup too.
        destroy();
        init();
      } else {
        addRegistration(matchMedia, key, setup);
      }
    },
    releaseLocks() {
      if (locks.size === 0) return;
      locks.clear();
      applyLock();
    },
    lock(reason) {
      const token = Symbol(reason);
      locks.set(token, reason);
      applyLock();
      return () => {
        if (!locks.delete(token)) return;
        applyLock();
      };
    },
    get running() {
      return matchMedia !== null;
    },
    get stats() {
      return { lenis: lenisCount, tickerCallbacks: tickerCount };
    },
  };
}
