// Card tilt: pure helpers and the registration gate (design section 10.4).
// Run with: node --test "tests/logic/card-tilt.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cardTiltRegistration,
  MAX_TILT_DEG,
  shouldTilt,
  TILT_ATTRIBUTE,
  TILT_CARD_SELECTOR,
  TILT_SKIP_CLASSES,
  tiltAngles,
  tiltEnabled,
} from '../../src/lib/motion/card-tilt.ts';

const flags = (over = {}) => ({ fullMotion: true, reduced: false, mobile: false, desktop: true, finePointer: true, ...over });

test('tiltAngles: centre is flat, edges reach +-5deg, direction follows the pointer', () => {
  assert.deepEqual(tiltAngles(0, 0), { rotationX: 0, rotationY: 0 });
  assert.equal(Object.is(tiltAngles(0, 0).rotationX, 0), true); // never -0
  assert.deepEqual(tiltAngles(1, 0), { rotationX: 0, rotationY: MAX_TILT_DEG });
  assert.deepEqual(tiltAngles(0, -1), { rotationX: MAX_TILT_DEG, rotationY: 0 });
  assert.equal(MAX_TILT_DEG, 5);
});

test('tiltAngles: result stays within +-5deg for any input, including out of range and non-finite', () => {
  let seed = 12345;
  const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 20; // -10..10
  for (let i = 0; i < 500; i += 1) {
    const { rotationX, rotationY } = tiltAngles(next(), next());
    assert.ok(Math.abs(rotationX) <= MAX_TILT_DEG && Math.abs(rotationY) <= MAX_TILT_DEG);
  }
  assert.deepEqual(tiltAngles(Number.NaN, Number.POSITIVE_INFINITY), { rotationX: 0, rotationY: 0 }); // non-finite is flat
});

test('tiltEnabled: needs full motion, fine pointer and desktop width', () => {
  assert.equal(tiltEnabled(flags()), true);
  assert.equal(tiltEnabled(flags({ fullMotion: false, reduced: true })), false);
  assert.equal(tiltEnabled(flags({ finePointer: false })), false);
  assert.equal(tiltEnabled(flags({ desktop: false, mobile: true })), false);
});

test('registration does nothing and returns no cleanup when the flags do not allow tilt', () => {
  let calls = 0;
  const api = new Proxy({}, { get: () => () => { calls += 1; return []; } });
  for (const over of [{ fullMotion: false, reduced: true }, { finePointer: false }, { desktop: false }]) {
    assert.equal(cardTiltRegistration(api, {})(flags(over)), undefined);
  }
  assert.equal(calls, 0);
});

// ---- Tilt scope: card-wide and card-compact keep their CSS lift ----

const classes = (...names) => new Set(names);
const list = (set) => ({ contains: (token) => set.has(token) });

test('shouldTilt: plain and tinted cards tilt; card-wide, card-compact and both are skipped', () => {
  assert.equal(shouldTilt(list(classes('card'))), true);
  assert.equal(shouldTilt(list(classes('card', 'card-linked'))), true);
  assert.equal(shouldTilt(list(classes('card', 'card-center'))), true);
  assert.equal(shouldTilt(list(classes('card', 'card-wide'))), false);
  assert.equal(shouldTilt(list(classes('card', 'card-compact'))), false);
  assert.equal(shouldTilt(list(classes('card', 'card-wide', 'card-compact'))), false);
  assert.equal(shouldTilt(list(classes('card-wide'))), false); // not a card at all
});

test('TILT_CARD_SELECTOR excludes exactly the skipped variants', () => {
  assert.deepEqual([...TILT_SKIP_CLASSES], ['card-wide', 'card-compact']);
  assert.equal(TILT_CARD_SELECTOR, '.card:not(.card-wide):not(.card-compact)');
});

/** A card with just enough surface for the registration: class list, attributes and listeners. */
function fakeCard(...names) {
  const attributes = new Map();
  const listeners = [];
  return {
    classList: list(classes('card', ...names)),
    style: { setProperty() {}, removeProperty() {} },
    attributes,
    listeners,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    addEventListener: (type) => listeners.push(type),
    offsetWidth: 0,
    offsetHeight: 0,
  };
}

test('registration: skipped cards get no data-tilt, no listeners and no quickTo; others do', () => {
  const plain = fakeCard();
  const tinted = fakeCard('card-linked');
  const wide = fakeCard('card-wide');
  const compact = fakeCard('card-compact');
  const both = fakeCard('card-wide', 'card-compact');
  const all = [wide, plain, compact, tinted, both];

  const calls = { selector: null, quickTo: 0, documentListeners: [] };
  const api = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'select') return (selector) => { calls.selector = selector; return all; };
        if (name === 'quickTo') return () => { calls.quickTo += 1; return () => {}; };
        return () => {};
      },
    },
  );
  const doc = {
    defaultView: { getComputedStyle: () => ({ getPropertyValue: () => '' }) },
    documentElement: {},
    addEventListener: (type) => calls.documentListeners.push(type),
  };

  const cleanup = cardTiltRegistration(api, doc)(flags());
  assert.equal(calls.selector, TILT_CARD_SELECTOR);
  for (const card of [plain, tinted]) {
    assert.equal(card.attributes.has(TILT_ATTRIBUTE), true);
    assert.ok(card.listeners.includes('pointerenter') && card.listeners.includes('focusin'));
  }
  for (const card of [wide, compact, both]) {
    assert.equal(card.attributes.has(TILT_ATTRIBUTE), false);
    assert.deepEqual(card.listeners, []);
  }
  assert.equal(calls.quickTo, 0); // quickTo only runs on pointerenter of a tilting card
  assert.deepEqual(calls.documentListeners, ['pointermove']);

  assert.equal(typeof cleanup, 'function');
  cleanup();
  for (const card of [plain, tinted]) assert.equal(card.attributes.has(TILT_ATTRIBUTE), false);
});

test('registration: a page with only skipped cards registers nothing', () => {
  const api = new Proxy({}, { get: (_t, name) => (name === 'select' ? () => [fakeCard('card-wide'), fakeCard('card-compact')] : () => {}) });
  let documentListeners = 0;
  const doc = {
    defaultView: { getComputedStyle: () => ({ getPropertyValue: () => '' }) },
    documentElement: {},
    addEventListener: () => { documentListeners += 1; },
  };
  assert.equal(cardTiltRegistration(api, doc)(flags()), undefined);
  assert.equal(documentListeners, 0);
});
