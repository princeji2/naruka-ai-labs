/**
 * Pure colour parsing and formatting for the token bridge.
 * Channels are sRGB in the range 0..1. No DOM access, no colour literals.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Rgba extends Rgb {
  readonly a: number;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/;
const FUNCTION = /^(rgba?|color)\(\s*([^()]*?)\s*\)$/;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Parses one component. `scale` is the value that maps to 1 for a plain number
 * (255 for rgb channels, 1 for color(srgb) channels and alpha). A percentage
 * always maps 100% to 1. The keyword `none` is treated as 0.
 */
function parseComponent(token: string, scale: number): number | null {
  if (token === 'none') return 0;
  if (!NUMBER.test(token)) return null;
  const percent = token.endsWith('%');
  const value = Number(percent ? token.slice(0, -1) : token);
  if (!Number.isFinite(value)) return null;
  return clamp01(percent ? value / 100 : value / scale);
}

function parseTriple(tokens: readonly string[], scale: number): [number, number, number] | null {
  if (tokens.length !== 3) return null;
  const [t0, t1, t2] = tokens;
  if (t0 === undefined || t1 === undefined || t2 === undefined) return null;
  const r = parseComponent(t0, scale);
  const g = parseComponent(t1, scale);
  const b = parseComponent(t2, scale);
  if (r === null || g === null || b === null) return null;
  return [r, g, b];
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  return parseComponent(token, 1);
}

function splitWhitespace(text: string): string[] {
  const trimmed = text.trim();
  return trimmed === '' ? [] : trimmed.split(/\s+/);
}

/** `rgb()` / `rgba()` with comma syntax (`1, 2, 3, 0.5`) or space syntax (`1 2 3 / 0.5`). */
function parseRgbFunction(body: string): Rgba | null {
  let channels: string[];
  let alphaToken: string | undefined;

  if (body.includes(',')) {
    if (body.includes('/')) return null;
    const parts = body.split(',').map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    channels = parts.slice(0, 3);
    alphaToken = parts[3];
  } else {
    const halves = body.split('/');
    if (halves.length > 2) return null;
    channels = splitWhitespace(halves[0] ?? '');
    if (halves.length === 2) {
      const alphaParts = splitWhitespace(halves[1] ?? '');
      if (alphaParts.length !== 1) return null;
      alphaToken = alphaParts[0];
    }
  }

  const triple = parseTriple(channels, 255);
  const a = parseAlpha(alphaToken);
  if (triple === null || a === null) return null;
  return { r: triple[0], g: triple[1], b: triple[2], a };
}

/** `color(srgb r g b)` and `color(srgb r g b / a)`; other colour spaces are rejected. */
function parseColorFunction(body: string): Rgba | null {
  const halves = body.split('/');
  if (halves.length > 2) return null;
  const [space, ...channels] = splitWhitespace(halves[0] ?? '');
  if (space !== 'srgb') return null;

  let alphaToken: string | undefined;
  if (halves.length === 2) {
    const alphaParts = splitWhitespace(halves[1] ?? '');
    if (alphaParts.length !== 1) return null;
    alphaToken = alphaParts[0];
  }

  const triple = parseTriple(channels, 1);
  const a = parseAlpha(alphaToken);
  if (triple === null || a === null) return null;
  return { r: triple[0], g: triple[1], b: triple[2], a };
}

/**
 * Parses what `getComputedStyle().color` can return: `rgb()`, `rgba()` and
 * `color(srgb ...)`, with comma or space syntax. Returns `null` for everything else.
 */
export function parseCssColor(input: string): Rgba | null {
  const match = FUNCTION.exec(input.trim().toLowerCase());
  if (match === null) return null;
  const name = match[1];
  const body = match[2];
  if (name === undefined || body === undefined) return null;
  return name === 'color' ? parseColorFunction(body) : parseRgbFunction(body);
}

/** Formats as space-syntax `rgb(r g b / a)` with 0..255 integer channels. */
export function formatRgb(color: Rgba): string {
  const channel = (value: number): number => Math.round(clamp01(value) * 255);
  const alpha = Number(clamp01(color.a).toFixed(4));
  return `rgb(${channel(color.r)} ${channel(color.g)} ${channel(color.b)} / ${alpha})`;
}
