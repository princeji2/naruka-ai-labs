/**
 * Mobile navigation drawer (toggle, close button, backdrop, link close, Escape, focus trap, scroll lock).
 *
 * `setupMobileMenu` is the `setup(): Cleanup` of the page lifecycle gate (design section 15). `Navbar.astro`
 * binds it once per session with `bindPageLifecycle(createGate(...))`; every enter re-queries the current
 * DOM, so a swapped-in page gets a working drawer and the old page's drawer is torn down.
 *
 * The cleanup aborts every listener, cancels the pending focus timer, closes the drawer without moving
 * focus, and releases the scroll lock (the Scroll_Controller lock and the native `overflow` fallback).
 */
import type { Cleanup } from '../lifecycle/page-lifecycle.ts';

export interface MobileMenuDeps {
  readonly document: Document;
  /** Receives the keydown listener (Escape and the focus trap). */
  readonly window: Window;
  /** Takes a named scroll lock and returns its release function (the Scroll_Controller's `lock`). */
  readonly lockScroll: (reason: string) => () => void;
  /** Timer functions, injectable for tests. Default to the globals. */
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
export const SCROLL_LOCK_REASON = 'nav-drawer';
/** Delay before the close button takes focus, so the drawer transition has started. */
export const FOCUS_DELAY_MS = 50;

export function setupMobileMenu(deps: MobileMenuDeps): Cleanup | void {
  const doc = deps.document;
  const toggleBtn = doc.getElementById('mobile-menu-toggle');
  const closeBtn = doc.getElementById('mobile-close-btn');
  const backdrop = doc.getElementById('mobile-drawer-backdrop');
  const drawer = doc.getElementById('mobile-nav-drawer');
  if (toggleBtn === null || drawer === null) return;

  const startTimer = deps.setTimeout ?? ((callback: () => void, ms: number): unknown => globalThis.setTimeout(callback, ms));
  const stopTimer = deps.clearTimeout ?? ((handle: unknown): void => globalThis.clearTimeout(handle as number));

  // One controller owns every listener of this setup.
  const abort = new AbortController();
  const { signal } = abort;

  let isOpen = false;
  let releaseScrollLock: (() => void) | null = null;
  let focusTimer: unknown = null;

  const getFocusable = (): HTMLElement[] => Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));

  const clearFocusTimer = (): void => {
    if (focusTimer !== null) stopTimer(focusTimer);
    focusTimer = null;
  };

  const lockScroll = (): void => {
    // Stops Lenis (a no-op while Lenis is not running, for example under reduced motion) ...
    releaseScrollLock?.();
    releaseScrollLock = deps.lockScroll(SCROLL_LOCK_REASON);
    // ... and this line is the native path when Lenis is not running.
    doc.body.style.overflow = 'hidden';
  };

  const unlockScroll = (): void => {
    releaseScrollLock?.();
    releaseScrollLock = null;
    doc.body.style.overflow = '';
  };

  const openMenu = (): void => {
    isOpen = true;
    toggleBtn.setAttribute('aria-expanded', 'true');
    drawer.setAttribute('aria-hidden', 'false');
    drawer.classList.add('is-open');
    lockScroll();
    // Focus the close button after the transition starts.
    clearFocusTimer();
    focusTimer = startTimer(() => {
      focusTimer = null;
      closeBtn?.focus();
    }, FOCUS_DELAY_MS);
  };

  /** Closes the drawer. `moveFocus` is false during teardown so focus is never pulled across pages. */
  const closeMenu = (moveFocus: boolean): void => {
    isOpen = false;
    clearFocusTimer();
    toggleBtn.setAttribute('aria-expanded', 'false');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.classList.remove('is-open');
    unlockScroll();
    if (moveFocus) toggleBtn.focus();
  };
  const onClose = (): void => closeMenu(true);

  toggleBtn.addEventListener(
    'click',
    () => {
      if (isOpen) closeMenu(true);
      else openMenu();
    },
    { signal },
  );
  closeBtn?.addEventListener('click', onClose, { signal });
  backdrop?.addEventListener('click', onClose, { signal });

  // Trap focus inside the drawer and handle Escape. Both exist only while the drawer is open.
  deps.window.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (!isOpen) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
        return;
      }

      if (event.key === 'Tab') {
        const focusable = getFocusable();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first === undefined || last === undefined) return;

        if (event.shiftKey) {
          if (doc.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else if (doc.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    { signal },
  );

  // Close when a link inside the drawer is followed.
  for (const link of drawer.querySelectorAll('.mobile-nav-link')) {
    link.addEventListener('click', onClose, { signal });
  }

  return () => {
    abort.abort();
    // Leave the page as if the drawer had been closed, without moving focus.
    closeMenu(false);
  };
}
