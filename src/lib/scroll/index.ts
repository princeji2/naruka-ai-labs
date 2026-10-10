/**
 * Real wiring for the Scroll_Controller: GSAP, ScrollTrigger, CustomEase and Lenis.
 * Import `scrollController` from here; the DI core in `./scroll-controller.ts` stays library-free.
 */
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { createScrollController } from './scroll-controller.ts';

export type {
  MotionFlags,
  MotionSetup,
  ScrollController,
  ScrollControllerStats,
} from './scroll-controller.ts';
export { MOTION_QUERIES } from './scroll-controller.ts';

let pluginsRegistered = false;

export const scrollController = createScrollController({
  registerPlugins() {
    if (pluginsRegistered) return;
    gsap.registerPlugin(ScrollTrigger, CustomEase);
    ScrollTrigger.config({ ignoreMobileResize: true });
    pluginsRegistered = true;
  },
  // The GSAP ticker owns the frame (autoRaf off). Native anchors stay so the skip link moves focus.
  // Touch keeps native momentum scrolling.
  createLenis: () =>
    new Lenis({ autoRaf: false, lerp: 0.1, smoothWheel: true, anchors: false, syncTouch: false }),
  createMatchMedia: () => gsap.matchMedia(),
  ticker: gsap.ticker,
  scrollTrigger: ScrollTrigger,
  fontsReady: () => ('fonts' in document ? document.fonts.ready : Promise.resolve()),
  onError(scope, error) {
    if (import.meta.env.DEV) console.error(`[scroll] ${scope}`, error);
  },
});

if (import.meta.env.DEV) {
  // Phase 5 leak checks read this: Lenis instances, ticker callbacks and live ScrollTriggers.
  Object.defineProperty(globalThis, '__narukaMotionStats', {
    configurable: true,
    get: () => ({ ...scrollController.stats, scrollTriggers: ScrollTrigger.getAll().length }),
  });
}
