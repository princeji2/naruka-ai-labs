/**
 * Render loop predicate for a Scene_3D. Pure.
 *
 * The loop runs only when everything allows it: the first frame exists, the quality profile animates,
 * the scene is near the viewport, the tab is visible, motion is allowed, and the WebGL context is alive
 * (Requirements 7.1, 8.4, 8.5).
 */
export interface RunInputs {
  /** First frame produced. */
  readonly ready: boolean;
  /** IntersectionObserver on the `.scene` element. */
  readonly inView: boolean;
  /** `document.visibilityState === 'hidden'`. */
  readonly documentHidden: boolean;
  readonly reducedMotion: boolean;
  readonly contextLost: boolean;
  /** From the quality profile. */
  readonly animate: boolean;
}

export function shouldRun(i: RunInputs): boolean {
  return i.ready && i.animate && i.inView && !i.documentHidden && !i.reducedMotion && !i.contextLost;
}
