// Page scripts under the ClientRouter: drawer, copy button and auth toggle enter on every swap, leave
// cleanly, and never stack listeners or locks. Fake EventTarget-based document/window, no browser.
// Run with: node --test "tests/logic/script-lifecycle.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindPageLifecycle, createGate } from '../../src/lib/lifecycle/page-lifecycle.ts';
import { FOCUS_DELAY_MS, SCROLL_LOCK_REASON, setupMobileMenu } from '../../src/lib/ui/mobile-menu.ts';
import { COPIED_RESET_MS, COPY_ADDRESS, setupCopyButton } from '../../src/lib/ui/copy-button.ts';
import { FORM_NOTE_TEXT, setupAuthToggle } from '../../src/lib/ui/auth-toggle.ts';

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

class FakeElement extends EventTarget {
  constructor(doc, id, { classes = [], attrs = {}, text = '' } = {}) {
    super();
    this.doc = doc;
    this.id = id;
    this.classes = new Set(classes);
    this.attrs = new Map(Object.entries(attrs));
    this.textContent = text;
    this.inert = false;
    this.focusCount = 0;
    this.children = [];
    this.classList = {
      add: (...names) => names.forEach((n) => this.classes.add(n)),
      remove: (...names) => names.forEach((n) => this.classes.delete(n)),
      toggle: (name, force) => {
        const on = force ?? !this.classes.has(name);
        if (on) this.classes.add(name);
        else this.classes.delete(name);
        return on;
      },
      contains: (name) => this.classes.has(name),
    };
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name) {
    this.attrs.delete(name);
  }
  focus() {
    this.focusCount += 1;
    this.doc.activeElement = this;
  }
  querySelectorAll(selector) {
    return this.children.filter((child) => child.matches?.(selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.readyState = 'complete';
    this.activeElement = null;
    this.body = { style: { overflow: '' } };
    this.byId = new Map();
  }
  getElementById(id) {
    return this.byId.get(id) ?? null;
  }
  add(el) {
    this.byId.set(el.id, el);
    return el;
  }
  /** Replaces the page DOM, as a router swap does. */
  swapBody() {
    this.byId = new Map();
    this.body = { style: { overflow: '' } };
    this.activeElement = null;
  }
}

const click = (el) => el.dispatchEvent(new Event('click'));
const key = (target, name, extra = {}) => {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key: name, ...extra });
  target.dispatchEvent(event);
  return event;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout(callback, ms) {
      const id = next++;
      pending.set(id, { callback, ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    get pending() {
      return pending.size;
    },
    runAll() {
      for (const [id, { callback }] of [...pending]) {
        pending.delete(id);
        callback();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Navbar drawer
// ---------------------------------------------------------------------------------------------

function buildNavbar(doc) {
  const toggle = doc.add(new FakeElement(doc, 'mobile-menu-toggle', { attrs: { 'aria-expanded': 'false' } }));
  const close = doc.add(new FakeElement(doc, 'mobile-close-btn'));
  const backdrop = doc.add(new FakeElement(doc, 'mobile-drawer-backdrop'));
  const drawer = doc.add(new FakeElement(doc, 'mobile-nav-drawer', { attrs: { 'aria-hidden': 'true' } }));
  const link = new FakeElement(doc, 'link', { classes: ['mobile-nav-link'] });
  link.matches = (selector) => selector === '.mobile-nav-link' || selector.includes('[href]');
  close.matches = (selector) => selector.includes('button');
  drawer.children = [close, link];
  return { toggle, close, backdrop, drawer, link };
}

function bindNavbar(doc, win, timers) {
  const locks = { held: 0, taken: 0, reasons: [] };
  const gate = createGate(() =>
    setupMobileMenu({
      document: doc,
      window: win,
      lockScroll: (reason) => {
        locks.held += 1;
        locks.taken += 1;
        locks.reasons.push(reason);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          locks.held -= 1;
        };
      },
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    }),
  );
  bindPageLifecycle(gate, { document: doc, window: win });
  return { gate, locks };
}

test('navbar: open drawer is closed, unlocked and inert on leave, and nothing reacts afterwards', () => {
  const doc = new FakeDocument();
  const win = new EventTarget();
  const timers = fakeTimers();
  const page = buildNavbar(doc);
  const { gate, locks } = bindNavbar(doc, win, timers);
  assert.equal(gate.active, true);

  click(page.toggle);
  assert.equal(page.drawer.classes.has('is-open'), true);
  assert.equal(page.toggle.getAttribute('aria-expanded'), 'true');
  assert.deepEqual([locks.held, locks.reasons[0]], [1, SCROLL_LOCK_REASON]);
  assert.equal(doc.body.style.overflow, 'hidden');
  assert.equal(timers.pending, 1, 'the focus timer is pending');

  doc.dispatchEvent(new Event('astro:before-swap'));
  assert.equal(gate.active, false);
  assert.equal(page.drawer.classes.has('is-open'), false);
  assert.equal(page.drawer.getAttribute('aria-hidden'), 'true');
  assert.equal(page.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(locks.held, 0, 'scroll lock released on leave');
  assert.equal(doc.body.style.overflow, '');
  assert.equal(timers.pending, 0, 'the pending focus timer is cancelled');
  assert.equal(page.toggle.focusCount + page.close.focusCount, 0, 'focus is not moved across pages');

  // Old listeners are gone: clicks and Escape on the old page do nothing.
  click(page.toggle);
  assert.equal(page.drawer.classes.has('is-open'), false);
  assert.equal(locks.taken, 1);
  key(win, 'Escape');
  assert.equal(page.toggle.focusCount, 0);
});

test('navbar: five swaps keep exactly one live setup (one lock, one Escape close)', () => {
  const doc = new FakeDocument();
  const win = new EventTarget();
  const timers = fakeTimers();
  buildNavbar(doc);
  const { gate, locks } = bindNavbar(doc, win, timers);

  let page;
  for (let swap = 1; swap <= 5; swap += 1) {
    doc.dispatchEvent(new Event('astro:before-swap'));
    doc.swapBody();
    page = buildNavbar(doc);
    doc.dispatchEvent(new Event('astro:after-swap'));
    assert.equal(gate.active, true);
  }

  click(page.toggle);
  assert.equal(locks.held, 1, 'a single lock after five swaps');
  assert.equal(locks.taken, 1);
  timers.runAll();
  assert.equal(page.close.focusCount, 1, 'the close button takes focus once');
  const escape = key(win, 'Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(page.toggle.focusCount, 1, 'one close, one focus return (no stacked handlers)');
  assert.equal(locks.held, 0);
  assert.equal(page.drawer.classes.has('is-open'), false);
  assert.equal(FOCUS_DELAY_MS, 50);
});

test('navbar: link, close button and backdrop close the drawer; Tab wraps inside it', () => {
  const doc = new FakeDocument();
  const win = new EventTarget();
  const timers = fakeTimers();
  const page = buildNavbar(doc);
  const { locks } = bindNavbar(doc, win, timers);

  for (const closer of [page.close, page.backdrop, page.link]) {
    click(page.toggle);
    assert.equal(page.drawer.classes.has('is-open'), true);
    click(closer);
    assert.equal(page.drawer.classes.has('is-open'), false);
    assert.equal(locks.held, 0);
  }

  click(page.toggle);
  doc.activeElement = page.link; // last focusable
  const tab = key(win, 'Tab');
  assert.equal(tab.defaultPrevented, true);
  assert.equal(doc.activeElement, page.close, 'Tab from the last element wraps to the first');
});

test('navbar: a page without a drawer is a no-op', () => {
  const doc = new FakeDocument();
  const { gate } = bindNavbar(doc, new EventTarget(), fakeTimers());
  assert.equal(gate.active, true);
  doc.dispatchEvent(new Event('astro:before-swap'));
  assert.equal(gate.active, false);
});

// ---------------------------------------------------------------------------------------------
// Contact copy button
// ---------------------------------------------------------------------------------------------

function buildContact(doc) {
  const button = doc.add(new FakeElement(doc, 'copy-btn'));
  const label = doc.add(new FakeElement(doc, 'copy-text', { text: 'Copy Address' }));
  return { button, label };
}

function bindContact(doc, timers, clipboard, warnings) {
  const gate = createGate(() =>
    setupCopyButton({
      document: doc,
      clipboard,
      warn: (message, error) => warnings.push([message, error]),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    }),
  );
  bindPageLifecycle(gate, { document: doc, window: new EventTarget() });
  return gate;
}

test('copy button: copies, shows the state, resets on its own timer and on leave', async () => {
  const doc = new FakeDocument();
  const timers = fakeTimers();
  const written = [];
  const page = buildContact(doc);
  bindContact(doc, timers, { writeText: async (text) => void written.push(text) }, []);

  click(page.button);
  assert.equal(page.button.getAttribute('aria-busy'), 'true');
  await flush();
  assert.deepEqual(written, [COPY_ADDRESS]);
  assert.equal(page.label.textContent, 'Copied to Clipboard!');
  assert.equal(page.button.classes.has('copied'), true);
  assert.equal(timers.pending, 1);
  timers.runAll();
  assert.deepEqual(
    [page.label.textContent, page.button.classes.has('copied'), page.button.getAttribute('aria-busy')],
    ['Copy Address', false, null],
  );
  assert.equal(COPIED_RESET_MS, 2200);

  // Leave while the "Copied" state is showing: label restored, timer cancelled, listener gone.
  click(page.button);
  await flush();
  assert.equal(page.label.textContent, 'Copied to Clipboard!');
  doc.dispatchEvent(new Event('astro:before-swap'));
  assert.deepEqual([page.label.textContent, page.button.classes.has('copied'), timers.pending], ['Copy Address', false, 0]);
  click(page.button);
  await flush();
  assert.equal(written.length, 2, 'no click handler survives the leave');
  assert.equal(page.button.getAttribute('aria-busy'), null);
});

test('copy button: a write that resolves after leave changes nothing; failure warns once', async () => {
  const doc = new FakeDocument();
  const timers = fakeTimers();
  const warnings = [];
  const page = buildContact(doc);
  let resolveWrite;
  bindContact(doc, timers, { writeText: () => new Promise((resolve) => (resolveWrite = resolve)) }, warnings);
  click(page.button);
  doc.dispatchEvent(new Event('astro:before-swap'));
  resolveWrite();
  await flush();
  assert.equal(page.label.textContent, 'Copy Address');
  assert.equal(timers.pending, 0);

  const doc2 = new FakeDocument();
  const page2 = buildContact(doc2);
  bindContact(doc2, timers, undefined, warnings);
  click(page2.button);
  await flush();
  assert.equal(page2.label.textContent, 'Copy Failed — Select Below');
  assert.equal(page2.button.classes.has('is-error'), true);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], 'Clipboard write failed:');
});

test('copy button: re-enters on the swapped-in page and is a no-op where there is no button', async () => {
  const doc = new FakeDocument();
  const timers = fakeTimers();
  const written = [];
  const clipboard = { writeText: async (text) => void written.push(text) };
  buildContact(doc);
  const gate = bindContact(doc, timers, clipboard, []);

  doc.dispatchEvent(new Event('astro:before-swap'));
  doc.swapBody(); // some other page: no copy button
  doc.dispatchEvent(new Event('astro:after-swap'));
  assert.equal(gate.active, true);

  doc.dispatchEvent(new Event('astro:before-swap'));
  doc.swapBody();
  const page = buildContact(doc); // back on Contact
  doc.dispatchEvent(new Event('astro:after-swap'));
  click(page.button);
  await flush();
  assert.deepEqual(written, [COPY_ADDRESS], 'exactly one write per click after two swaps');
});

// ---------------------------------------------------------------------------------------------
// Sign-in toggle
// ---------------------------------------------------------------------------------------------

function buildAuth(doc) {
  const el = (id, options) => doc.add(new FakeElement(doc, id, options));
  const page = {
    auth: el('auth'),
    live: el('auth-live'),
    signInForm: el('form-signin'),
    signUpForm: el('form-signup'),
    signUpPanel: el('panel-signup'),
    signInPanel: el('panel-signin'),
    signInTitle: el('title-signin'),
    signUpTitle: el('title-signup'),
    showSignUp: el('show-signup'),
    showSignIn: el('show-signin'),
  };
  page.signUpForm.inert = true;
  page.signInPanel.inert = true;
  const note = new FakeElement(doc, 'note');
  note.matches = (selector) => selector === '[data-form-note]';
  page.signInForm.children = [note];
  page.signInForm.querySelector = (selector) => (selector === '[data-form-note]' ? note : null);
  page.note = note;
  return page;
}

test('sign-in toggle: switches modes, handles submit, tears down on leave, re-enters on the next page', () => {
  const doc = new FakeDocument();
  let page = buildAuth(doc);
  const gate = createGate(() => setupAuthToggle({ document: doc }));
  bindPageLifecycle(gate, { document: doc, window: new EventTarget() });

  click(page.showSignUp);
  assert.equal(page.auth.classes.has('sign-up-mode'), true);
  assert.deepEqual([page.signInForm.inert, page.signUpForm.inert, page.signUpPanel.inert, page.signInPanel.inert], [true, false, true, false]);
  assert.equal(page.live.textContent, 'Sign up form shown.');
  assert.equal(page.signUpTitle.focusCount, 1);

  const submit = new Event('submit', { cancelable: true });
  page.signInForm.dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.equal(page.note.textContent, FORM_NOTE_TEXT);

  doc.dispatchEvent(new Event('astro:before-swap'));
  click(page.showSignIn);
  assert.equal(page.auth.classes.has('sign-up-mode'), true, 'listeners are gone after leave');

  // Five visits: fresh DOM each time, exactly one handler per page.
  for (let visit = 0; visit < 5; visit += 1) {
    doc.swapBody();
    page = buildAuth(doc);
    doc.dispatchEvent(new Event('astro:after-swap'));
    click(page.showSignUp);
    click(page.showSignIn);
    assert.equal(page.signUpTitle.focusCount, 1);
    assert.equal(page.signInTitle.focusCount, 1);
    assert.equal(page.auth.classes.has('sign-up-mode'), false);
    doc.dispatchEvent(new Event('astro:before-swap'));
  }

  // A page without the widget does not throw.
  doc.swapBody();
  doc.dispatchEvent(new Event('astro:after-swap'));
  assert.equal(gate.active, true);
});

// ---------------------------------------------------------------------------------------------
// Scroll controller teardown (real GSAP semantics)
// ---------------------------------------------------------------------------------------------

test('scroll controller: destroy runs registration cleanups the way GSAP does (kill only cleans up when asked to revert)', async () => {
  const { createScrollController } = await import('../../src/lib/scroll/scroll-controller.ts');
  const cleanups = [];
  const controller = createScrollController({
    registerPlugins() {},
    createLenis: () => ({ on() {}, raf() {}, start() {}, stop() {}, destroy() {} }),
    createMatchMedia: () => ({
      add(_queries, setup) {
        const cleanup = setup({ conditions: { fullMotion: true } });
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      },
      // gsap.matchMedia(): MatchMedia.kill(revert) -> Context.kill(revert) runs the cleanups only if `revert` is truthy.
      kill(revert) {
        if (!revert) return;
        for (const cleanup of cleanups.splice(0)) cleanup();
      },
    }),
    ticker: { add() {}, remove() {}, lagSmoothing() {} },
    scrollTrigger: { update() {}, refresh() {}, getAll: () => [], clearScrollMemory() {} },
  });
  let live = 0;
  controller.register('listener-owner', () => {
    live += 1; // for example the card-tilt document pointermove listener
    return () => {
      live -= 1;
    };
  });
  for (let cycle = 0; cycle < 5; cycle += 1) {
    controller.init();
    controller.destroy();
  }
  assert.equal(live, 0, 'every registration cleanup ran on destroy');
  assert.equal(controller.stats.lenis, 0);
});
