/**
 * Connecting lines for the Particle_Constellation. Pure and deterministic, no DOM access.
 *
 * The topology is computed once per field: the whole group rotates rigidly, so relative
 * distances never change and there is no per-frame link work.
 */

export interface LinkConfig {
  /** Largest link length (inclusive). */
  readonly distance: number;
  /** Most pairs returned. */
  readonly maxLinks: number;
  /** Most pairs any single point may belong to. */
  readonly maxDegree: number;
}

/** Each axis has at most this many grid cells, so the numeric cell key stays below 2^48. */
const MAX_CELLS_PER_AXIS = 65536;

function toLimit(value: number): number {
  return Number.isNaN(value) ? 0 : Math.max(0, Math.floor(value));
}

/**
 * Returns packed index pairs [i0, j0, i1, j1, …] with i < j, no pair twice.
 *
 * Pairs are found with a uniform grid (cell size `distance`, so a point only checks its 27
 * neighbouring cells). `i` runs ascending; for each `i` the candidates `j > i` are taken in
 * ascending order. A pair is kept when its squared length (dx² + dy² + dz²) is at most
 * `distance²`, neither endpoint has reached `maxDegree`, and fewer than `maxLinks` pairs exist.
 * Points with a non-finite coordinate never link. `count` is clamped to what `positions` holds.
 */
export function buildLinks(positions: Float32Array, count: number, cfg: LinkConfig): Uint32Array {
  const n = Math.min(toLimit(count), Math.floor(positions.length / 3));
  const distance = cfg.distance;
  const maxLinks = toLimit(cfg.maxLinks);
  const maxDegree = toLimit(cfg.maxDegree);
  if (n < 2 || !(distance >= 0) || !Number.isFinite(distance) || maxLinks === 0 || maxDegree === 0) {
    return new Uint32Array(0);
  }

  // Bounding box of the finite points.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] ?? NaN;
    const y = positions[i * 3 + 1] ?? NaN;
    const z = positions[i * 3 + 2] ?? NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    valid[i] = 1;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (minX === Infinity) return new Uint32Array(0);

  // A cell larger than `distance` is still correct (more candidates, same result), so the grid
  // is widened when `distance` is tiny compared with the extent of the points.
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const cell = Math.max(distance, span / (MAX_CELLS_PER_AXIS - 1), Number.MIN_VALUE);
  const nx = Math.floor((maxX - minX) / cell) + 1;
  const ny = Math.floor((maxY - minY) / cell) + 1;

  const cellX = new Int32Array(n);
  const cellY = new Int32Array(n);
  const cellZ = new Int32Array(n);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (valid[i] === 0) continue;
    const cx = Math.floor(((positions[i * 3] ?? 0) - minX) / cell);
    const cy = Math.floor(((positions[i * 3 + 1] ?? 0) - minY) / cell);
    const cz = Math.floor(((positions[i * 3 + 2] ?? 0) - minZ) / cell);
    cellX[i] = cx;
    cellY[i] = cy;
    cellZ[i] = cz;
    const key = cx + nx * (cy + ny * cz);
    const bucket = grid.get(key);
    if (bucket === undefined) grid.set(key, [i]);
    else bucket.push(i);
  }

  const maxDistSq = distance * distance;
  const degree = new Uint32Array(n);
  const pairs: number[] = [];
  const candidates: number[] = [];
  let links = 0;

  for (let i = 0; i < n && links < maxLinks; i++) {
    if (valid[i] === 0 || (degree[i] ?? 0) >= maxDegree) continue;
    const ix = positions[i * 3] ?? 0;
    const iy = positions[i * 3 + 1] ?? 0;
    const iz = positions[i * 3 + 2] ?? 0;
    const cx = cellX[i] ?? 0;
    const cy = cellY[i] ?? 0;
    const cz = cellZ[i] ?? 0;

    candidates.length = 0;
    for (let oz = -1; oz <= 1; oz++) {
      const gz = cz + oz;
      if (gz < 0) continue;
      for (let oy = -1; oy <= 1; oy++) {
        const gy = cy + oy;
        if (gy < 0 || gy >= ny) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          if (gx < 0 || gx >= nx) continue;
          const bucket = grid.get(gx + nx * (gy + ny * gz));
          if (bucket === undefined) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const dx = (positions[j * 3] ?? 0) - ix;
            const dy = (positions[j * 3 + 1] ?? 0) - iy;
            const dz = (positions[j * 3 + 2] ?? 0) - iz;
            if (dx * dx + dy * dy + dz * dz <= maxDistSq) candidates.push(j);
          }
        }
      }
    }
    candidates.sort((a, b) => a - b);

    for (const j of candidates) {
      if (links >= maxLinks || (degree[i] ?? 0) >= maxDegree) break;
      if ((degree[j] ?? 0) >= maxDegree) continue;
      pairs.push(i, j);
      degree[i] = (degree[i] ?? 0) + 1;
      degree[j] = (degree[j] ?? 0) + 1;
      links++;
    }
  }

  return Uint32Array.from(pairs);
}
