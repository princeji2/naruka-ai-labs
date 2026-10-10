/**
 * Sign-in / sign-up toggle for the placeholder `/signin` page. No network requests, no storage, no auth:
 * both forms are inert and a submit only shows a note.
 *
 * `setupAuthToggle` is the `setup(): Cleanup` of the page lifecycle gate (design section 15). The page binds
 * it once per session; every enter re-queries the current DOM and does nothing on a page without the auth
 * widget. The cleanup aborts every listener. The widget's state (`sign-up-mode`, `inert`) lives in the page
 * DOM, which a swap replaces with fresh server markup, so there is nothing to reset on leave.
 */
import type { Cleanup } from '../lifecycle/page-lifecycle.ts';

export interface AuthToggleDeps {
  readonly document: Document;
}

export const FORM_NOTE_TEXT = 'This is a placeholder. Sign in and sign up are not available yet.';

export function setupAuthToggle(deps: AuthToggleDeps): Cleanup | void {
  const doc = deps.document;
  const auth = doc.getElementById('auth');
  const live = doc.getElementById('auth-live');
  const signInForm = doc.getElementById('form-signin');
  const signUpForm = doc.getElementById('form-signup');
  const signUpPanel = doc.getElementById('panel-signup'); // left panel: "New here?" + Sign up button
  const signInPanel = doc.getElementById('panel-signin'); // right panel: "One of us?" + Sign in button
  const signInTitle = doc.getElementById('title-signin');
  const signUpTitle = doc.getElementById('title-signup');
  const showSignUp = doc.getElementById('show-signup');
  const showSignIn = doc.getElementById('show-signin');
  if (
    auth === null ||
    live === null ||
    signInForm === null ||
    signUpForm === null ||
    signUpPanel === null ||
    signInPanel === null ||
    signInTitle === null ||
    signUpTitle === null ||
    showSignUp === null ||
    showSignIn === null
  ) {
    return;
  }

  const abort = new AbortController();
  const { signal } = abort;

  // will-change: transform on the 2000px circle is expensive to keep resident, so it is only set
  // while a switch is running. The circle is a ::before pseudo-element; its transitionend bubbles to
  // .auth. The flag is cleared on the first transform transitionend after a toggle.
  auth.addEventListener(
    'transitionend',
    (event) => {
      if (event.propertyName === 'transform') auth.classList.remove('is-switching');
    },
    { signal },
  );

  // Only the visible form and its matching panel can be reached by keyboard or screen reader.
  const setMode = (signUp: boolean, moveFocus: boolean): void => {
    auth.classList.add('is-switching');
    auth.classList.toggle('sign-up-mode', signUp);
    signInForm.inert = signUp;
    signUpForm.inert = !signUp;
    signUpPanel.inert = signUp;
    signInPanel.inert = !signUp;

    live.textContent = signUp ? 'Sign up form shown.' : 'Sign in form shown.';

    // The button that was just pressed becomes inert, so move focus to the new form heading.
    if (moveFocus) (signUp ? signUpTitle : signInTitle).focus({ preventScroll: true });
  };

  showSignUp.addEventListener('click', () => setMode(true, true), { signal });
  showSignIn.addEventListener('click', () => setMode(false, true), { signal });

  // Inert submit: cancel it and say so. Nothing is sent anywhere.
  for (const form of [signInForm, signUpForm]) {
    form.addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        const note = form.querySelector<HTMLElement>('[data-form-note]');
        if (note !== null) note.textContent = FORM_NOTE_TEXT;
      },
      { signal },
    );
  }

  return () => {
    abort.abort();
  };
}
