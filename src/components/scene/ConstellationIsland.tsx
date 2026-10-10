/**
 * Island shell for the hero Particle_Constellation (design section 5).
 *
 * Imports React and tiny pure helpers only. `three`, `@react-three/fiber` and `@react-three/drei` are
 * reachable solely through the dynamic `import()` behind `lazy(...)`, so they stay out of the main
 * payload (Requirements 8.1, 8.2).
 *
 * Render contract: every render (server, first client render and later ones) outputs one inert, invisible
 * anchor element (`<span aria-hidden data-scene-anchor>`, 1x1 px, transparent, absolutely positioned in
 * `.scene-layer`) and nothing else until the scene commits. The CSS poster in the Astro wrapper
 * (`ScenePoster.astro`) is what the visitor sees, and server and client markup are identical, so there is
 * no hydration mismatch (Requirement 9.2).
 *
 * The anchor is also what makes `client:visible` work: Astro's directive observes the CHILD ELEMENTS of
 * the `<astro-island>` with an IntersectionObserver (`astro/dist/runtime/client/visible.js`). A component
 * that rendered nothing left the island childless, so nothing was observed and it never hydrated. The
 * anchor must therefore be laid out (not `hidden` / `display: none`, which an IntersectionObserver never
 * reports as intersecting). It also locates the closest `.scene` for `data-scene-state`.
 *
 * An effect then decides, after the main thread is idle, whether to upgrade:
 *
 *   checking  -> anchor only, state `poster`
 *   poster    -> tier `poster` (save-data / low memory) or WebGL unavailable; anchor only
 *   scene     -> lazy scene mounted inside an error boundary; state `live` once it has committed
 *
 * The closest `.scene` carries `data-scene-state` (`poster`, `live`, `failed`) so the Astro CSS can
 * react. A failed dynamic import or a scene that throws lands in {@link SceneBoundary}, which marks the
 * region `failed` and renders nothing, so the poster stays and the page is unaffected (Requirement 8.10).
 *
 * The reduced-motion and width media queries are listened to, so the tier changes live without a reload
 * (Requirement 7.5).
 */
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LITE_MAX_WIDTH_EXCLUSIVE, readSceneEnvironment, selectQuality, type PosterReason, type QualityProfile } from '../../lib/scene/quality.ts';
import { whenIdle } from '../../lib/scene/idle.ts';
import { detectWebGL } from '../../lib/scene/webgl-support.ts';

const ConstellationScene = lazy(() => import('./ConstellationScene.tsx'));

/** Longest the upgrade check may wait for an idle period, so the poster never lingers (milliseconds). */
const IDLE_TIMEOUT_MS = 1500;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** True exactly when `window.innerWidth < LITE_MAX_WIDTH_EXCLUSIVE` (the `lite` tier boundary). */
const NARROW_QUERY = `(max-width: ${LITE_MAX_WIDTH_EXCLUSIVE - 0.02}px)`;

type SceneState = 'poster' | 'live' | 'failed';

type Phase =
  | { readonly kind: 'checking' }
  | { readonly kind: 'poster'; readonly reason: PosterReason | 'no-webgl' }
  | { readonly kind: 'scene'; readonly quality: QualityProfile };

const CHECKING: Phase = { kind: 'checking' };

/**
 * Inline so the anchor is laid out from the first server-rendered byte. Zero visual output (no content, no
 * background, no border), 1x1 px, top-left of the positioned `.scene-layer`, never hit by the pointer.
 */
const ANCHOR_STYLE = {
  display: 'block',
  position: 'absolute',
  inset: 0,
  width: 1,
  height: 1,
  pointerEvents: 'none',
} as const;

interface SceneBoundaryProps {
  readonly onFail: (error: unknown) => void;
  readonly children: ReactNode;
}

interface SceneBoundaryState {
  readonly failed: boolean;
}

/** Catches render errors and rejected lazy imports from the scene subtree; renders nothing when it fails. */
class SceneBoundary extends Component<SceneBoundaryProps, SceneBoundaryState> {
  state: SceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    if (import.meta.env.DEV) console.debug('[ConstellationIsland] scene failed, keeping the poster', error);
    this.props.onFail(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Renders nothing; tells the shell the lazy scene has been committed. */
function SceneCommitted({ onCommitted }: { readonly onCommitted: () => void }): null {
  useEffect(() => {
    onCommitted();
  }, [onCommitted]);
  return null;
}

export default function ConstellationIsland(): ReactNode {
  const [phase, setPhase] = useState<Phase>(CHECKING);
  const [failed, setFailed] = useState(false);
  // The observable anchor (see the render contract above); also used to find the closest `.scene`.
  const anchorRef = useRef<HTMLSpanElement>(null);

  const markScene = useCallback((state: SceneState): void => {
    anchorRef.current?.closest('.scene')?.setAttribute('data-scene-state', state);
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia(REDUCED_MOTION_QUERY);
    const narrow = window.matchMedia(NARROW_QUERY);
    let cancelled = false;

    const evaluate = (): void => {
      if (cancelled) return;
      const quality = selectQuality(readSceneEnvironment(window, navigator, reduce.matches));
      if (quality.tier === 'poster') {
        setPhase({ kind: 'poster', reason: quality.posterReason });
        return;
      }
      if (!detectWebGL(document)) {
        setPhase({ kind: 'poster', reason: 'no-webgl' });
        return;
      }
      setPhase({ kind: 'scene', quality });
    };

    // Keep the first paint (LCP) and main-thread work (TBT) clear: decide only when idle.
    const cancelIdle = whenIdle(evaluate, IDLE_TIMEOUT_MS);
    reduce.addEventListener('change', evaluate);
    narrow.addEventListener('change', evaluate);
    return () => {
      cancelled = true;
      cancelIdle();
      reduce.removeEventListener('change', evaluate);
      narrow.removeEventListener('change', evaluate);
    };
  }, []);

  // Everything except a committed scene shows the poster. `live` is set by SceneCommitted.
  useEffect(() => {
    if (failed) markScene('failed');
    else if (phase.kind !== 'scene') markScene('poster');
  }, [phase, failed, markScene]);

  const handleCommitted = useCallback((): void => markScene('live'), [markScene]);
  const handleFail = useCallback((): void => setFailed(true), []);

  return (
    <>
      <span ref={anchorRef} aria-hidden="true" data-scene-anchor="" style={ANCHOR_STYLE} />
      {phase.kind === 'scene' && !failed ? (
        <SceneBoundary onFail={handleFail}>
          <Suspense fallback={null}>
            <ConstellationScene quality={phase.quality} />
            <SceneCommitted onCommitted={handleCommitted} />
          </Suspense>
        </SceneBoundary>
      ) : null}
    </>
  );
}
