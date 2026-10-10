/**
 * Build-time reader for literal declarations in the token file.
 * Pure string processing: no DOM, no file system, safe to import from Node.
 */

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Returns the bodies of every top-level `:root { ... }` block, in source order.
 * Blocks nested in at-rules (for example inside `@media`) are not top-level and are skipped.
 */
function topLevelRootBodies(css: string): string[] {
  const bodies: string[] = [];
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = -1;
  let isRoot = false;

  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === '{') {
      if (depth === 0) {
        isRoot = css.slice(selectorStart, i).trim() === ':root';
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        if (isRoot && bodyStart >= 0) bodies.push(css.slice(bodyStart, i));
        isRoot = false;
        bodyStart = -1;
        selectorStart = i + 1;
      }
    } else if (char === ';' && depth === 0) {
      selectorStart = i + 1;
    }
  }
  return bodies;
}

/** Splits a block body into declarations on `;`, ignoring semicolons inside parentheses or quotes. */
function splitDeclarations(body: string): string[] {
  const declarations: string[] = [];
  let parens = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      parens += 1;
    } else if (char === ')') {
      parens = Math.max(0, parens - 1);
    } else if (char === ';' && parens === 0) {
      declarations.push(body.slice(start, i));
      start = i + 1;
    }
  }
  declarations.push(body.slice(start));
  return declarations;
}

/**
 * Returns the value of the first `name: value;` declaration found in a top-level `:root` block.
 * Comments and other declarations are ignored. Throws if the token is missing or if its value is
 * not a plain literal (it contains `var(` or `color-mix(`).
 */
export function readTokenDeclaration(css: string, name: string): string {
  const clean = stripComments(css);

  for (const body of topLevelRootBodies(clean)) {
    for (const declaration of splitDeclarations(body)) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      if (declaration.slice(0, colon).trim() !== name) continue;

      const value = declaration
        .slice(colon + 1)
        .replace(/!important\s*$/i, '')
        .trim();
      if (/var\(|color-mix\(/i.test(value)) {
        throw new Error(`Design token ${name} is not a plain literal: "${value}"`);
      }
      if (value === '') {
        throw new Error(`Design token ${name} has an empty value`);
      }
      return value;
    }
  }
  throw new Error(`Design token ${name} is not declared in :root`);
}
