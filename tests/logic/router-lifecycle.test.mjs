// Router-safe page lifecycle: event mapping, data-motion gate across swaps, scroll lock release.
// Run with: node --test "tests/logic/router-lifecycle.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindPageLifecycle, createGate } from '../../src/lib/lifecycle/page-lifecycle.ts';
import { bindMotionGate, MOTION_FAILURE_MS } from '../../src/lib/motion/motion-gate.ts';
import { createScrollController } from '../../src/lib/scroll/scroll-controller.ts';

function fakeEmitter() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type, event = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, ...event });
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

test('lifecycle: first load enters once, astro:page-load is ignored, swaps leave then enter', () => {
  const doc = Object.assign(fakeEmitter(), { readyState: 'complete' });
  const win = fakeEmitter();
  let enters = 0;
  let leaves = 0;
  const gate = createGate(() => {
    enters += 1;
    return () => {
      leaves += 1;
    };
  });
  bindPageLifecycle(gate, { document: doc, window: win });
  assert.equal(enters, 1);

  doc.emit('astro:page-load');
  assert.equal(enters, 1, 'astro:page-load must not duplicate the entry');
  assert.equal(doc.count('astro:page-load'), 0);

  doc.emit('astro:before-swap');
  assert.deepEqual([enters, leaves, gate.active], [1, 1, false]);
  doc.emit('astro:after-swap');
  doc.emit('astro:after-swap');
  assert.deepEqual([enters, leaves, gate.active], [2, 1, true], 'a repeated after-swap enters once');
  doc.emit('astro:before-swap');
  win.emit('pagehide');
  assert.deepEqual([enters, leaves, gate.active], [2, 2, false], 'before-swap then pagehide leaves once');
});

test('motion gate: incoming document is marked pending and the failure timer restarts after the swap', () => {
  const attrs = new Map([['data-motion', 'ready']]);
  const root = {
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value),
  };
  const doc = Object.assign(fakeEmitter(), { documentElement: root });
  const timers = [];
  const unbind = bindMotionGate({
    document: doc,
    setTimeout: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      timer.cleared = true;
    },
  });

  const incoming = new Map();
  doc.emit('astro:before-swap', {
    newDocument: { documentElement: { setAttribute: (n, v) => incoming.set(n, v), getAttribute: (n) => incoming.get(n) ?? null } },
  });
  assert.equal(incoming.get('data-motion'), 'pending');

  // The router replaces the root attributes: the pending state arrives with them.
  attrs.set('data-motion', 'pending');
  doc.emit('astro:after-swap');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, MOTION_FAILURE_MS);
  timers[0].callback();
  assert.equal(attrs.get('data-motion'), 'failed', 'a page that never became ready shows its content');

  // A page that did become ready is left alone, and a swap cancels the previous page's timer.
  attrs.set('data-motion', 'ready');
  doc.emit('astro:after-swap');
  doc.emit('astro:before-swap', { newDocument: null });
  assert.equal(timers[1].cleared, true);
  timers[1].callback();
  assert.equal(attrs.get('data-motion'), 'ready');

  unbind();
  assert.equal(doc.count('astro:before-swap') + doc.count('astro:after-swap'), 0);
});

test('scroll controller: destroy clears scroll memory, releaseLocks restarts the next Lenis', () => {
  let memoryCleared = 0;
  let stopped = false;
  const lenisInstances = [];
  const controller = createScrollController({
    registerPlugins() {},
    createLenis: () => {
      const lenis = { on() {}, raf() {}, start: () => (stopped = false), stop: () => (stopped = true), destroy() {} };
      lenisInstances.push(lenis);
      return lenis;
    },
    createMatchMedia: () => {
      const cleanups = [];
      return {
        add(_queries, setup) {
          const cleanup = setup({ conditions: { fullMotion: true } });
          if (typeof cleanup === 'function') cleanups.push(cleanup);
        },
        kill() {
          for (const cleanup of cleanups.splice(0)) cleanup();
        },
      };
    },
    ticker: { add() {}, remove() {}, lagSmoothing() {} },
    scrollTrigger: {
      update() {},
      refresh() {},
      getAll: () => [],
      clearScrollMemory: () => {
        memoryCleared += 1;
      },
    },
  });

  controller.init();
  const release = controller.lock('nav-drawer');
  assert.equal(stopped, true);

  controller.destroy();
  assert.equal(memoryCleared, 1);
  controller.releaseLocks();
  controller.init();
  assert.equal(stopped, false, 'a lock from the old page must not stop the new page');
  assert.equal(controller.stats.lenis, 1);
  release(); // the old page's release function is now a no-op
  assert.equal(stopped, false);
  controller.destroy();
  assert.equal(controller.stats.lenis, 0);
});
