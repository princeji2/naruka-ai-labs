/**
 * Seeded pseudo random number generator for the scene data (Particle_Constellation).
 * Pure and deterministic: the same seed always yields the same sequence, in any environment.
 * No DOM access, so Node can import this file.
 */

/**
 * Mulberry32. Returns a function that yields numbers in [0, 1).
 * The seed is coerced to an unsigned 32-bit integer, so any number (including NaN) is accepted.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
