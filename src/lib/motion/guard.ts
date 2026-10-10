/**
 * Composited-only guard (R6.8, R6.9).
 *
 * GSAP tweens may animate only properties the compositor can handle. `findNonComposited` returns the
 * keys of a tween variable object that are neither composited properties nor tween control keys, so
 * `width`, `height`, `top`, `left` and friends are always reported.
 *
 * `autoAlpha` is allowed: it only adds `visibility`, which is not a Layout_Property.
 */

export const COMPOSITED_KEYS: ReadonlySet<string> = new Set([
  'opacity',
  'autoAlpha',
  'x',
  'y',
  'z',
  'xPercent',
  'yPercent',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'rotationX',
  'rotationY',
  'rotationZ',
  'skewX',
  'skewY',
  'transformPerspective',
  'transformOrigin',
]);

export const CONTROL_KEYS: ReadonlySet<string> = new Set([
  'duration',
  'delay',
  'ease',
  'stagger',
  'overwrite',
  'immediateRender',
  'onComplete',
  'onStart',
  'onUpdate',
  'paused',
  'repeat',
  'yoyo',
  'clearProps',
  'force3D',
  'scrollTrigger',
]);

/** Keys of `vars` that are in neither the composited nor the control set. Empty means the tween is allowed. */
export function findNonComposited(vars: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(vars).filter((key) => !COMPOSITED_KEYS.has(key) && !CONTROL_KEYS.has(key));
}
