/**
 * Motion defaults and token parsing (design assumption A1).
 *
 * `GSAP.md` gives no durations, easings or stagger values, so the reveal numbers come from tokens
 * that already exist in `tokens.css`, with the fallbacks below if a token cannot be read. Every number
 * the motion layer uses lives in this one file: if the user supplies real values, only this file changes.
 *
 * Pure apart from {@link readMotionTokens}, which takes the document as an argument, so Node can
 * import this module.
 */

/** Single source of truth for the media queries lives in the scroll controller. */
export { MOTION_QUERIES } from '../scroll/scroll-controller.ts';

/** Control points x1, y1, x2, y2 of a CSS cubic-bezier. */
export type CubicBezier = readonly [number, number, number, number];

export interface MotionTokens {
  /** Reveal duration in seconds (`--motion-duration-slower`, 600 ms). */
  readonly durationS: number;
  /** Reveal easing (`--ease-out`). */
  readonly ease: CubicBezier;
  /** Reveal travel distance in px (`--space-6`, 24 px). */
  readonly distancePx: number;
  /** Delay between items of one batch, in seconds. */
  readonly staggerS: number;
  /** ScrollTrigger start line. */
  readonly start: string;
  /** Constant fade duration under Reduced_Motion_Mode, in seconds. The CSS duration tokens collapse to 0.01 ms there. */
  readonly reducedFadeS: number;
}

export const MOTION_DEFAULTS: MotionTokens = {
  durationS: 0.6,
  ease: [0.23, 1, 0.32, 1],
  distancePx: 24,
  staggerS: 0.08,
  start: 'top 88%',
  reducedFadeS: 0.2,
};

/** Token names read by {@link readMotionTokens}. */
export const MOTION_TOKEN_NAMES = {
  duration: '--motion-duration-slower',
  ease: '--ease-out',
  distance: '--space-6',
} as const;

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const DURATION_PATTERN = new RegExp(String.raw`^(${NUMBER})(ms|s)$`, 'i');
const PX_PATTERN = new RegExp(String.raw`^(${NUMBER})px$`, 'i');
const NUMBER_PATTERN = new RegExp(`^${NUMBER}$`, 'i');
const BEZIER_PATTERN = /^cubic-bezier\(([^()]*)\)$/i;

/** Parses a CSS time (`600ms`, `0.6s`) into seconds. Returns null for anything else, including negatives. */
export function parseDurationToken(text: string): number | null {
  const match = DURATION_PATTERN.exec(text.trim());
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  return match[2]?.toLowerCase() === 'ms' ? value / 1000 : value;
}

/** Parses `cubic-bezier(x1, y1, x2, y2)`. Returns null unless all four are finite and x1, x2 are in [0, 1]. */
export function parseCubicBezier(text: string): CubicBezier | null {
  const match = BEZIER_PATTERN.exec(text.trim());
  if (match === null) return null;
  const parts = (match[1] ?? '').split(',').map((part) => part.trim());
  if (parts.length !== 4 || !parts.every((part) => NUMBER_PATTERN.test(part))) return null;
  const [x1, y1, x2, y2] = parts.map(Number);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return null;
  return [x1, y1, x2, y2];
}

/** Formats control points as a CSS `cubic-bezier(...)` string. Inverse of {@link parseCubicBezier}. */
export function formatCubicBezier(bezier: CubicBezier): string {
  return `cubic-bezier(${bezier.join(', ')})`;
}

/** Parses a pixel length (`24px`). Returns null for anything else. */
export function parsePxToken(text: string): number | null {
  const match = PX_PATTERN.exec(text.trim());
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads the reveal numbers from the document's computed tokens. Any token that is missing or does not
 * parse falls back to {@link MOTION_DEFAULTS}, so a reveal can never fail on a bad token.
 */
export function readMotionTokens(doc: Document = document): MotionTokens {
  const view = doc.defaultView;
  if (view === null) return MOTION_DEFAULTS;
  const style = view.getComputedStyle(doc.documentElement);
  const read = (name: string): string => style.getPropertyValue(name);

  return {
    ...MOTION_DEFAULTS,
    durationS: parseDurationToken(read(MOTION_TOKEN_NAMES.duration)) ?? MOTION_DEFAULTS.durationS,
    ease: parseCubicBezier(read(MOTION_TOKEN_NAMES.ease)) ?? MOTION_DEFAULTS.ease,
    distancePx: parsePxToken(read(MOTION_TOKEN_NAMES.distance)) ?? MOTION_DEFAULTS.distancePx,
  };
}
