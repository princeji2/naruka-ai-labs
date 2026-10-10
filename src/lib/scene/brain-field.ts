/**
 * Particle data for the hero Particle_Constellation: an organic brain-shaped cloud plus ambient
 * scattered points. Pure and deterministic for a given config (seeded PRNG), no DOM access.
 *
 * Colours are palette INDICES (0 accent, 1 primary, 2 secondary, 3 text). The scene resolves them
 * to Design_Tokens at runtime, so this file holds no colour value.
 *
 * Brain points are generated first and ambient points after, from one PRNG stream, so the brain
 * prefix of the arrays does not change when only `ambientCount` changes. Brain points are
 * interleaved between the parts (hemispheres, cerebellum, stem), so any prefix of the brain, and
 * any `maxLinks` cut in `buildLinks`, covers the whole shape.
 *
 * Axes: x lateral, y up, z front (+) to back (-).
 */
import { mulberry32 } from './prng.ts';

/** Palette slot count: index to token is 0 accent, 1 primary, 2 secondary, 3 text. */
export const PALETTE_SIZE = 4;

/** Every brain point lies inside the cube of half-size BRAIN_BOUND. */
export const BRAIN_BOUND = 1.4;

/** Inner radius of the ambient shell. */
const AMBIENT_INNER = 1.2;

export interface FieldConfig {
  readonly seed: number;
  readonly brainCount: number;
  readonly ambientCount: number;
  /** Outer bound for ambient points. */
  readonly ambientRadius: number;
}

export interface ParticleField {
  /** brainCount + ambientCount. */
  readonly count: number;
  /** xyz per particle. */
  readonly positions: Float32Array;
  /** Point size in px at the reference distance. */
  readonly sizes: Float32Array;
  /** Twinkle phase in [0, 2π]. */
  readonly phases: Float32Array;
  /** 0..PALETTE_SIZE-1. */
  readonly colorIndex: Uint8Array;
  /** 1 for ambient points, 0 for brain points. */
  readonly ambient: Uint8Array;
}

const TWO_PI = Math.PI * 2;

/** Margin that keeps a Float32 rounding of a value from stepping past its double bound. */
const SAFE = 1 - 1e-6;

/** Relative weights of the brain parts: left hemisphere, right hemisphere, cerebellum, stem. */
const PART_LEFT_CUT = 0.44;
const PART_RIGHT_CUT = 0.88;
const PART_CEREBELLUM_CUT = 0.98;

/** Palette weights as cumulative cut points, brain then ambient. */
const BRAIN_PALETTE_CUTS: readonly number[] = [0.3, 0.6, 0.9];
const AMBIENT_PALETTE_CUTS: readonly number[] = [0.28, 0.54, 0.8];

const HEMISPHERE_CENTRE_X = 0.3;
const HEMISPHERE_AXES = { x: 0.55, y: 0.7, z: 0.95 } as const;
const FISSURE_HALF_WIDTH = 0.04;

function toCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Half-size of the cube that contains every particle of a field with this config. */
export function fieldBound(cfg: FieldConfig): number {
  return Math.max(BRAIN_BOUND, ambientOuterRadius(cfg));
}

function ambientOuterRadius(cfg: FieldConfig): number {
  return Number.isFinite(cfg.ambientRadius) ? Math.max(cfg.ambientRadius, AMBIENT_INNER) : AMBIENT_INNER;
}

function clampAbs(value: number, limit: number): number {
  return value > limit ? limit : value < -limit ? -limit : value;
}

function gaussian(rng: () => number): number {
  const u1 = 1 - rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Unit vector from three seeded Gaussians (uniform on the sphere). */
function randomDirection(rng: () => number, out: Vec3): void {
  const x = gaussian(rng);
  const y = gaussian(rng);
  const z = gaussian(rng);
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) {
    out.x = 0;
    out.y = 1;
    out.z = 0;
    return;
  }
  out.x = x / length;
  out.y = y / length;
  out.z = z / length;
}

/** Radius that favours the surface, so the silhouette reads as an outline. */
function surfaceRadius(rng: () => number): number {
  const u = rng();
  return 1 - 0.35 * u * u * u;
}

function pickIndex(cuts: readonly number[], roll: number): number {
  for (let i = 0; i < cuts.length; i++) {
    if ((cuts[i] ?? 0) > roll) return i;
  }
  return cuts.length;
}

function sampleHemisphere(rng: () => number, side: 1 | -1, out: Vec3): void {
  randomDirection(rng, out);
  const r = surfaceRadius(rng);
  const dx = out.x;
  const dy = out.y;
  const dz = out.z;
  let x = side * HEMISPHERE_CENTRE_X + dx * r * HEMISPHERE_AXES.x;
  let y = dy * r * HEMISPHERE_AXES.y;
  let z = dz * r * HEMISPHERE_AXES.z;

  // Gyri: a small wave displacement along the surface direction.
  const gyri = 0.05 * (Math.sin(7 * x) + Math.sin(6 * y) + Math.sin(5 * z));
  x += dx * gyri;
  y += dy * gyri;
  z += dz * gyri;

  // Longitudinal fissure: keep each hemisphere on its own side and open a gap at the midline.
  if (side * x < FISSURE_HALF_WIDTH) {
    x = side * (FISSURE_HALF_WIDTH + 0.5 * Math.abs(x));
  }

  out.x = x;
  out.y = y;
  out.z = z;
}

function sampleCerebellum(rng: () => number, out: Vec3): void {
  randomDirection(rng, out);
  const r = surfaceRadius(rng);
  const dx = out.x;
  const dy = out.y;
  const dz = out.z;
  out.x = dx * r * 0.4;
  out.y = -0.62 + dy * r * 0.2;
  out.z = -0.6 + dz * r * 0.3;
}

function sampleStem(rng: () => number, out: Vec3): void {
  const t = rng();
  out.x = gaussian(rng) * 0.06;
  out.y = -0.45 - 0.65 * t;
  out.z = -0.25 - 0.1 * t + gaussian(rng) * 0.06;
}

/** Radius so that points are uniform in volume between `inner` and `outer`. */
function shellRadius(rng: () => number, inner: number, outer: number): number {
  const a = inner * inner * inner;
  const b = outer * outer * outer;
  return Math.cbrt(a + (b - a) * rng());
}

/**
 * Builds the particle field for `cfg`. Counts are floored and clamped to zero or more
 * (a non-finite count is zero). Brain points lie within BRAIN_BOUND; ambient points lie in the
 * shell between 1.2 and `ambientRadius` (raised to 1.2 if smaller). Every position component is
 * within `fieldBound(cfg)`.
 */
export function generateField(cfg: FieldConfig): ParticleField {
  const brainCount = toCount(cfg.brainCount);
  const ambientCount = toCount(cfg.ambientCount);
  const count = brainCount + ambientCount;
  const outer = ambientOuterRadius(cfg);

  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const colorIndex = new Uint8Array(count);
  const ambient = new Uint8Array(count);

  const rng = mulberry32(cfg.seed);
  const p: Vec3 = { x: 0, y: 0, z: 0 };
  const brainLimit = BRAIN_BOUND * SAFE;
  const ambientLimit = outer * SAFE;

  for (let i = 0; i < brainCount; i++) {
    const part = rng();
    if (part < PART_LEFT_CUT) sampleHemisphere(rng, -1, p);
    else if (part < PART_RIGHT_CUT) sampleHemisphere(rng, 1, p);
    else if (part < PART_CEREBELLUM_CUT) sampleCerebellum(rng, p);
    else sampleStem(rng, p);

    positions[i * 3] = clampAbs(p.x, brainLimit);
    positions[i * 3 + 1] = clampAbs(p.y, brainLimit);
    positions[i * 3 + 2] = clampAbs(p.z, brainLimit);
    sizes[i] = 1.6 + 1.6 * rng();
    phases[i] = rng() * TWO_PI * SAFE;
    colorIndex[i] = pickIndex(BRAIN_PALETTE_CUTS, rng());
    ambient[i] = 0;
  }

  const inner = Math.min(AMBIENT_INNER, outer);
  for (let k = 0; k < ambientCount; k++) {
    const i = brainCount + k;
    randomDirection(rng, p);
    const r = shellRadius(rng, inner, outer);
    positions[i * 3] = clampAbs(p.x * r, ambientLimit);
    positions[i * 3 + 1] = clampAbs(p.y * r, ambientLimit);
    positions[i * 3 + 2] = clampAbs(p.z * r, ambientLimit);
    sizes[i] = 1.2 + 1.2 * rng();
    phases[i] = rng() * TWO_PI * SAFE;
    colorIndex[i] = pickIndex(AMBIENT_PALETTE_CUTS, rng());
    ambient[i] = 1;
  }

  return { count, positions, sizes, phases, colorIndex, ambient };
}
