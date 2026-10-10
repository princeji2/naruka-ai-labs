/**
 * Contact page "copy address" button.
 *
 * `setupCopyButton` is the `setup(): Cleanup` of the page lifecycle gate (design section 15). The Contact
 * page binds it once per session; every enter re-queries the current DOM and does nothing on a page that
 * has no copy button. The cleanup aborts the click listener, cancels the pending label reset, and puts the
 * button back to its initial label and state (so a bfcache restore never shows a stale "Copied").
 */
import type { Cleanup } from '../lifecycle/page-lifecycle.ts';

export interface CopyButtonDeps {
  readonly document: Document;
  /** The clipboard, or `undefined` when the API is not available. */
  readonly clipboard?: Pick<Clipboard, 'writeText'> | undefined;
  /** Receives the warning when a clipboard write fails (the page passes its own console call). */
  readonly warn: (message: string, error: unknown) => void;
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

export const COPY_ADDRESS = 'naruka@orgs.social';
export const COPIED_RESET_MS = 2200;
export const FAILED_RESET_MS = 3000;

export function setupCopyButton(deps: CopyButtonDeps): Cleanup | void {
  const copyBtn = deps.document.getElementById('copy-btn');
  const copyText = deps.document.getElementById('copy-text');
  if (copyBtn === null || copyText === null) return;

  const startTimer = deps.setTimeout ?? ((callback: () => void, ms: number): unknown => globalThis.setTimeout(callback, ms));
  const stopTimer = deps.clearTimeout ?? ((handle: unknown): void => globalThis.clearTimeout(handle as number));

  const abort = new AbortController();
  const { signal } = abort;
  const initialLabel = copyText.textContent;
  let resetTimer: unknown = null;

  const clearResetTimer = (): void => {
    if (resetTimer !== null) stopTimer(resetTimer);
    resetTimer = null;
  };

  /** Back to the markup's initial state. */
  const reset = (): void => {
    copyText.textContent = initialLabel;
    copyBtn.classList.remove('copied', 'is-error');
    copyBtn.removeAttribute('aria-busy');
  };

  const scheduleReset = (ms: number): void => {
    clearResetTimer();
    resetTimer = startTimer(() => {
      resetTimer = null;
      reset();
    }, ms);
  };

  copyBtn.addEventListener(
    'click',
    async () => {
      copyBtn.setAttribute('aria-busy', 'true');
      try {
        const clipboard = deps.clipboard;
        if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
          throw new Error('Clipboard API not supported');
        }
        await clipboard.writeText(COPY_ADDRESS);
        if (signal.aborted) return; // the page was left while the write was pending
        copyText.textContent = 'Copied to Clipboard!';
        copyBtn.classList.remove('is-error');
        copyBtn.classList.add('copied');
        scheduleReset(COPIED_RESET_MS);
      } catch (err) {
        if (signal.aborted) return;
        deps.warn('Clipboard write failed:', err);
        copyText.textContent = 'Copy Failed — Select Below';
        copyBtn.classList.remove('copied');
        copyBtn.classList.add('is-error');
        scheduleReset(FAILED_RESET_MS);
      }
    },
    { signal },
  );

  return () => {
    abort.abort();
    clearResetTimer();
    reset();
  };
}
