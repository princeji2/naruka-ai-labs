/**
 * Header registration (design sections 3.7 and 10.1).
 *
 * Two effects, both owned by one matchMedia run so they revert together:
 *
 * 1. `data-scrolled` on `#site-header`. A ScrollTrigger (`start: 'top -8'`, `onToggle`) sets it once the
 *    page has scrolled past 8 px and removes it again at the top. CSS in `Navbar.astro` fades the
 *    background layer and the hairline in with an `opacity` transition. This is state, not motion, so it
 *    runs in every mode (under reduced motion the CSS transition collapses to an instant change). The
 *    trigger has no `scrub` and no `pin`.
 * 2. Drawer link stagger, `fullMotion` only: when `#mobile-nav-drawer` gets the `is-open` class the
 *    `.mobile-nav-links li` items rise in (opacity and `y`, staggered). The drawer itself works with no
 *    motion: its state is `is-open`, `aria-expanded` and `aria-hidden`, managed by the Navbar script.
 *
 * Takes the {@link MotionApi} facade instead of GSAP, so a recorder can stand in for it. Nothing here
 * touches `document` at import time, so Node can import this file.
 */
import type { MotionSetup } from '../scroll/scroll-controller.ts';
import type { MotionApi } from './api.ts';
import { parseDurationToken, parsePxToken, formatCubicBezier, type MotionTokens } from './config.ts';

export const HEADER_KEY = 'header';
export const HEADER_SELECTOR = '#site-header';
export const SCROLLED_ATTRIBUTE = 'data-scrolled';
/** ScrollTrigger start: the page has scrolled 8 px. */
export const HEADER_SCROLL_START = 'top -8';
/** Same threshold in px, for the initial state when the page loads already scrolled. */
export const HEADER_SCROLL_THRESHOLD_PX = 8;

export const DRAWER_SELECTOR = '#mobile-nav-drawer';
export const DRAWER_OPEN_CLASS = 'is-open';
export const DRAWER_ITEM_SELECTOR = '.mobile-nav-links li';
/** Properties the stagger leaves inline; cleared when it ends or the registration is cleaned up. */
const CLEAR_PROPS = 'opacity,transform';

/** Used only if the tokens cannot be read. They equal the `tokens.css` values. */
const FALLBACK = { durationS: 0.32, distancePx: 16 } as const;

interface DrawerTiming {
  readonly durationS: number;
  readonly distancePx: number;
}

function readDrawerTiming(doc: Document): DrawerTiming {
  const view = doc.defaultView;
  if (view === null) return FALLBACK;
  const style = view.getComputedStyle(doc.documentElement);
  return {
    durationS: parseDurationToken(style.getPropertyValue('--motion-duration-slow')) ?? FALLBACK.durationS,
    distancePx: parsePxToken(style.getPropertyValue('--space-5')) ?? FALLBACK.distancePx,
  };
}

export function headerRegistration(
  api: MotionApi,
  tokens: () => MotionTokens,
  doc: Document = document,
): MotionSetup {
  return (flags) => {
    const header = api.select(HEADER_SELECTOR)[0];
    if (header === undefined) return;
    const view = doc.defaultView;

    const setScrolled = (scrolled: boolean): void => {
      header.toggleAttribute(SCROLLED_ATTRIBUTE, scrolled);
    };
    // Correct from the first frame when the page is restored already scrolled.
    setScrolled((view?.scrollY ?? 0) > HEADER_SCROLL_THRESHOLD_PX);
    // 'max' keeps the trigger active down to the bottom of the page.
    api.trigger({ trigger: doc.body, start: HEADER_SCROLL_START, end: 'max', onToggle: setScrolled });

    let observer: MutationObserver | null = null;
    const items: HTMLElement[] = [];

    if (flags.fullMotion && !flags.reduced && view !== null) {
      const drawer = api.select(DRAWER_SELECTOR)[0];
      items.push(...api.select(DRAWER_ITEM_SELECTOR));
      if (drawer !== undefined && items.length > 0) {
        const motion = tokens();
        const timing = readDrawerTiming(doc);
        const ease = formatCubicBezier(motion.ease);
        let wasOpen = drawer.classList.contains(DRAWER_OPEN_CLASS);
        observer = new view.MutationObserver(() => {
          const open = drawer.classList.contains(DRAWER_OPEN_CLASS);
          if (open && !wasOpen) {
            api.fromTo(
              items,
              { opacity: 0, y: timing.distancePx },
              {
                opacity: 1,
                y: 0,
                duration: timing.durationS,
                ease,
                stagger: motion.staggerS,
                overwrite: true,
                clearProps: CLEAR_PROPS,
              },
            );
          }
          wasOpen = open;
        });
        observer.observe(drawer, { attributes: true, attributeFilter: ['class'] });
      }
    }

    return () => {
      observer?.disconnect();
      // overwrite: true also stops a stagger still running when the preference flips.
      if (items.length > 0) api.set(items, { clearProps: CLEAR_PROPS, overwrite: true });
      header.removeAttribute(SCROLLED_ATTRIBUTE);
    };
  };
}
