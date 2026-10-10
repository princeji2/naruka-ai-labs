/**
 * Shared scroll progress for the hero scene. A plain mutable object: the ScrollTrigger side writes it,
 * the `useFrame` side reads it. No React state, no re-render, and no dependency on `three`, so it can
 * live in a shared chunk without pulling the 3D libraries into the main payload.
 *
 * Under reduced motion no scrubbed trigger exists, so `progress` stays 0 (Requirement 7.2).
 */
export const scrollBridge: { progress: number } = { progress: 0 };

/** Stores `p` clamped to [0, 1]. Non-finite input (NaN, Infinity, -Infinity) is stored as 0. */
export function setScrollProgress(p: number): void {
  scrollBridge.progress = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
}
