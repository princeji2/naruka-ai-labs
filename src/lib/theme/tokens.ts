import { parseCssColor, type Rgba } from './color.ts';

export type TokenName = `--${string}`;

/** Thrown when a design token is absent from the document or does not resolve to a colour. */
export class MissingTokenError extends Error {
  readonly token: string;

  constructor(token: string, detail: string) {
    super(`Design token ${token} ${detail}`);
    this.name = 'MissingTokenError';
    this.token = token;
  }
}

export interface TokenReader {
  /** Resolves a colour token to its used sRGB value (var() and color-mix() are flattened by the browser). */
  color(name: TokenName): Rgba;
  /** Drops cached values, for example after a theme change. */
  invalidate(): void;
}

/**
 * Creates a reader that resolves colour tokens through the browser. A probe element gets
 * `color: var(--token)` and its used `color` is read back, so derived tokens resolve too.
 */
export function createTokenReader(doc: Document): TokenReader {
  const cache = new Map<TokenName, Rgba>();
  const probe = doc.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';

  return {
    color(name: TokenName): Rgba {
      const hit = cache.get(name);
      if (hit !== undefined) return hit;

      const view = doc.defaultView;
      if (view === null) throw new MissingTokenError(name, 'cannot be read: the document has no window');

      const root = doc.documentElement;
      // A missing token would silently inherit a default colour, so check it is declared first.
      if (view.getComputedStyle(root).getPropertyValue(name).trim() === '') {
        throw new MissingTokenError(name, 'is not defined');
      }

      probe.style.color = `var(${name})`;
      root.appendChild(probe);
      const used = view.getComputedStyle(probe).color;
      probe.remove();

      const parsed = parseCssColor(used);
      if (parsed === null) throw new MissingTokenError(name, `did not resolve to a colour (got "${used}")`);
      cache.set(name, parsed);
      return parsed;
    },
    invalidate(): void {
      cache.clear();
    },
  };
}
