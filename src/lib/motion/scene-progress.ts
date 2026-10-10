/**
 * Scene progress registration (design sections 3.7 and 8).
 *
 * A scrubbed trigger on the hero section writes its scroll progress (0 at the top of the page, 1 once the
 * section has scrolled out) into the scroll bridge, which the Scene_3D `useFrame` reads. No React state,
 * and this file imports neither `three` nor `react`.
 *
 * Runs only for `desktop && fullMotion`. Under reduced motion, or on mobile, no trigger exists, so the
 * bridge stays at 0 and the scene shows its static pose. Cleanup resets the bridge to 0.
 *
 * Takes the {@link MotionApi} facade instead of GSAP, so a recorder can stand in for it. Nothing here
 * touches `document` at import time, so Node can import this file.
 */
import type { MotionFlags, MotionSetup } from '../scroll/scroll-controller.ts';
import { setScrollProgress } from '../scene/scroll-bridge.ts';
import type { MotionApi } from './api.ts';

export const SCENE_PROGRESS_KEY = 'scene-progress';
export const HERO_SELECTOR = '.hero-section';
export const SCENE_PROGRESS_START = 'top top';
export const SCENE_PROGRESS_END = 'bottom top';

/** The registration only runs for full motion at desktop width. */
export function sceneProgressEnabled(flags: MotionFlags): boolean {
  return flags.fullMotion && !flags.reduced && flags.desktop;
}

export function sceneProgressRegistration(api: MotionApi): MotionSetup {
  return (flags) => {
    if (!sceneProgressEnabled(flags)) return;
    const hero = api.select(HERO_SELECTOR)[0];
    if (hero === undefined) return;

    api.trigger({
      trigger: hero,
      start: SCENE_PROGRESS_START,
      end: SCENE_PROGRESS_END,
      scrub: true,
      onUpdate: setScrollProgress,
    });

    return () => {
      setScrollProgress(0);
    };
  };
}
