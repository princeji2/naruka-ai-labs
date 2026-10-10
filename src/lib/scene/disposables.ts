/**
 * Tracks resources that were created imperatively (outside JSX, so React Three Fiber does not dispose
 * them) and releases them together (Requirement 8.6). Each tracked item is disposed exactly once;
 * `disposeAll` is idempotent. Pure: no dependency on `three`.
 */
export interface Disposable {
  dispose(): void;
}

export interface DisposableBag {
  /** Registers an item and returns it. Tracking the same item twice disposes it once. */
  track<T extends Disposable>(item: T): T;
  /** Disposes every tracked item once, in tracking order, then empties the bag. */
  disposeAll(): void;
  /** Number of items waiting to be disposed. */
  readonly size: number;
}

export function createDisposableBag(): DisposableBag {
  let items = new Set<Disposable>();
  return {
    track<T extends Disposable>(item: T): T {
      items.add(item);
      return item;
    },
    disposeAll(): void {
      // Empty the bag first so a re-entrant or repeated call cannot dispose anything twice.
      const pending = items;
      items = new Set<Disposable>();
      let failed = false;
      let firstError: unknown;
      for (const item of pending) {
        try {
          item.dispose();
        } catch (error) {
          // Keep releasing the rest; report the first failure afterwards.
          if (!failed) {
            failed = true;
            firstError = error;
          }
        }
      }
      if (failed) throw firstError;
    },
    get size(): number {
      return items.size;
    },
  };
}
