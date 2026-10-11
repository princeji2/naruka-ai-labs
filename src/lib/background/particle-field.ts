/**
 * Pure particle simulation for the Background_Component.
 *
 * Ported from the particles.js configuration in `refrence/background.txt`:
 * density 140 per 800 area units, size 1 to 3 with size animation, opacity 0.3 to 0.7 with
 * opacity animation, speed 2 with random direction and bounce at the edges, link distance 160,
 * grab distance 220, push adds 4. No DOM access and no colours, so Node can import this module.
 * The density and link-line opacity are then lowered ~1/3 (to 93 and 0.27) so the network stays
 * quiet behind text; see DESKTOP_CONFIG.
 *
 * Units: positions in CSS px, velocities in px per second, `step` takes milliseconds.
 */

export interface Particle {
  x: number;
  y: number;
  /** Velocity in px per second. */
  vx: number;
  vy: number;
  /** Radius in px. */
  r: number;
  /** Opacity, 0..1. */
  a: number;
  /** Radius change per second (sign is the current direction). */
  dr: number;
  /** Opacity change per second (sign is the current direction). */
  da: number;
}

export interface Bounds {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BackgroundConfig {
  /** Particle count per `densityArea` units of area (`number.value`). */
  readonly densityValue: number;
  /** Area unit of the density, in thousands of px squared (`density.value_area`). */
  readonly densityArea: number;
  /** Hard cap on the particle count for this budget. */
  readonly maxCount: number;
  /** Reference `move.speed`. Reference particles travel `speed / 2` px per frame at 60 fps at most. */
  readonly speed: number;
  readonly sizeMin: number;
  readonly sizeMax: number;
  /** Reference `size.anim.speed`, in hundredths of a px per frame. */
  readonly sizeAnimSpeed: number;
  readonly opacityMin: number;
  readonly opacityMax: number;
  /** Reference `opacity.anim.speed`, in hundredths per frame. */
  readonly opacityAnimSpeed: number;
  /** Stroke width around each particle (`shape.stroke.width`). */
  readonly strokeWidth: number;
  readonly linkDistance: number;
  readonly linkOpacity: number;
  readonly linkWidth: number;
  readonly grabDistance: number;
  readonly grabLinkOpacity: number;
  /** Particles added by one click (`modes.push.particles_nb`). */
  readonly pushCount: number;
}

/** The reference ran its animation at 60 frames per second. */
const REFERENCE_FPS = 60;
/** Longest time step the simulation accepts, so a background tab or a long frame cannot teleport particles. */
export const MAX_STEP_MS = 100;

export const DESKTOP_CONFIG: BackgroundConfig = {
  // Density and link-line opacity lowered ~1/3 from the reference (140 -> 93, 0.4 -> 0.27) so the
  // network stays quiet behind text and does not compete with the hero scene.
  densityValue: 93,
  densityArea: 800,
  maxCount: 220,
  speed: 2,
  sizeMin: 1,
  sizeMax: 3,
  sizeAnimSpeed: 2,
  opacityMin: 0.3,
  opacityMax: 0.7,
  opacityAnimSpeed: 1,
  strokeWidth: 0.5,
  linkDistance: 160,
  linkOpacity: 0.27,
  linkWidth: 1.2,
  grabDistance: 220,
  grabLinkOpacity: 0.8,
  pushCount: 4,
};

/** Mobile_Viewport budget (Requirement 8.8): same look, a much smaller particle cap. */
export const MOBILE_CONFIG: BackgroundConfig = { ...DESKTOP_CONFIG, maxCount: 60 };

export function configFor(mobile: boolean): BackgroundConfig {
  return mobile ? MOBILE_CONFIG : DESKTOP_CONFIG;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function validSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Number of particles for a canvas of the given size: the reference density rule
 * (`area / 1000 * value / value_area`), rounded and capped at `cfg.maxCount`.
 * Non-decreasing in area; 0 for an empty or invalid area.
 */
export function particleCountForArea(b: Bounds, cfg: BackgroundConfig): number {
  const area = validSize(b.width) * validSize(b.height);
  if (area === 0) return 0;
  const raw = Math.round(((area / 1000) * cfg.densityValue) / cfg.densityArea);
  return Math.min(Math.max(raw, 0), Math.max(Math.floor(cfg.maxCount), 0));
}

function makeParticle(x: number, y: number, rng: () => number, cfg: BackgroundConfig): Particle {
  // Reference: velocity is random in -0.5..0.5 per frame, scaled by speed / 2.
  const perSecond = (cfg.speed / 2) * REFERENCE_FPS;
  const sizeSpan = cfg.sizeMax - cfg.sizeMin;
  const opacitySpan = cfg.opacityMax - cfg.opacityMin;
  return {
    x,
    y,
    vx: (rng() - 0.5) * perSecond,
    vy: (rng() - 0.5) * perSecond,
    r: cfg.sizeMin + rng() * sizeSpan,
    a: cfg.opacityMin + rng() * opacitySpan,
    dr: (rng() < 0.5 ? -1 : 1) * (cfg.sizeAnimSpeed / 100) * REFERENCE_FPS,
    da: (rng() < 0.5 ? -1 : 1) * (cfg.opacityAnimSpeed / 100) * REFERENCE_FPS,
  };
}

/** Creates `count` particles at random positions inside the bounds. `rng` returns values in [0, 1). */
export function createParticles(b: Bounds, count: number, rng: () => number, cfg: BackgroundConfig): Particle[] {
  const width = validSize(b.width);
  const height = validSize(b.height);
  const total = Number.isFinite(count) ? Math.max(Math.floor(count), 0) : 0;
  const list: Particle[] = [];
  for (let i = 0; i < total; i += 1) {
    list.push(makeParticle(clamp(rng() * width, 0, width), clamp(rng() * height, 0, height), rng, cfg));
  }
  return list;
}

/** Moves a value along one axis with edge bounce. Returns the new position and velocity. */
function bounce(position: number, velocity: number, dt: number, max: number): [number, number] {
  let next = position + velocity * dt;
  let v = velocity;
  if (next < 0) {
    next = 0;
    v = Math.abs(v);
  } else if (next > max) {
    next = max;
    v = -Math.abs(v);
  }
  return [next, v];
}

/** Advances a value that oscillates between `min` and `max`. Returns the new value and rate. */
function oscillate(value: number, rate: number, dt: number, min: number, max: number): [number, number] {
  let next = value + rate * dt;
  let r = rate;
  if (next >= max) {
    next = max;
    r = -Math.abs(r);
  } else if (next <= min) {
    next = min;
    r = Math.abs(r);
  }
  return [next, r];
}

/**
 * Advances every particle by `dtMs`: move, bounce off the edges, animate size and opacity.
 * Mutates the particles in place. A non-positive or non-finite step does nothing; a step longer than
 * {@link MAX_STEP_MS} is shortened. After the call every particle is inside the bounds.
 */
export function step(ps: Particle[], b: Bounds, dtMs: number, cfg: BackgroundConfig = DESKTOP_CONFIG): void {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return;
  const dt = Math.min(dtMs, MAX_STEP_MS) / 1000;
  const width = validSize(b.width);
  const height = validSize(b.height);
  for (const p of ps) {
    const [x, vx] = bounce(p.x, p.vx, dt, width);
    const [y, vy] = bounce(p.y, p.vy, dt, height);
    const [r, dr] = oscillate(p.r, p.dr, dt, cfg.sizeMin, cfg.sizeMax);
    const [a, da] = oscillate(p.a, p.da, dt, cfg.opacityMin, cfg.opacityMax);
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.r = r;
    p.dr = dr;
    p.a = a;
    p.da = da;
  }
}

/**
 * Adds exactly `n` particles at `at` (a click). When `bounds` is given the position is clamped
 * inside it. Mutates `ps`. Use {@link capParticles} afterwards to keep the list within the budget.
 */
export function push(
  ps: Particle[],
  at: Point,
  n: number,
  rng: () => number,
  cfg: BackgroundConfig,
  bounds?: Bounds,
): void {
  const total = Number.isFinite(n) ? Math.max(Math.floor(n), 0) : 0;
  const x = bounds === undefined ? at.x : clamp(at.x, 0, validSize(bounds.width));
  const y = bounds === undefined ? at.y : clamp(at.y, 0, validSize(bounds.height));
  for (let i = 0; i < total; i += 1) ps.push(makeParticle(x, y, rng, cfg));
}

/** Drops the oldest particles so that at most `max` remain. Mutates `ps`. */
export function capParticles(ps: Particle[], max: number): void {
  const limit = Number.isFinite(max) ? Math.max(Math.floor(max), 0) : 0;
  if (ps.length > limit) ps.splice(0, ps.length - limit);
}

/**
 * Resizes the list to the target count after a canvas resize: removes the oldest particles when
 * there are too many, adds random ones when there are too few, and pulls survivors back inside
 * the new bounds.
 */
export function resizeField(ps: Particle[], b: Bounds, target: number, rng: () => number, cfg: BackgroundConfig): void {
  const width = validSize(b.width);
  const height = validSize(b.height);
  for (const p of ps) {
    p.x = clamp(p.x, 0, width);
    p.y = clamp(p.y, 0, height);
  }
  capParticles(ps, target);
  const missing = Math.max(Math.floor(target), 0) - ps.length;
  if (missing > 0) ps.push(...createParticles(b, missing, rng, cfg));
}
