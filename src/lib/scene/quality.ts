/**
 * Quality profile for the Particle_Constellation (Scene_3D): which tier to run, how many particles and
 * links to build, and the device pixel ratio cap.
 *
 * Pure. The only browser-facing helper, {@link readSceneEnvironment}, takes the window and navigator
 * as arguments, so Node can import this module. `deviceMemory` and `connection.saveData` are
 * non-standard, so they are read through the typed {@link NavigatorWithHints} extension (no `any`).
 *
 * Tier table (design section 6.3):
 *
 * | Tier     | When                                  | Brain + ambient | Max links | DPR cap | Animates |
 * |----------|---------------------------------------|-----------------|-----------|---------|----------|
 * | `poster` | `saveData`, or `deviceMemory <= 2`    | 0               | 0         | 1       | no       |
 * | `frame`  | reduced motion                        | by width        | by width  | <= 2    | no       |
 * | `lite`   | width below 768                       | 600 + 120       | 500       | <= 1.5  | yes      |
 * | `full`   | otherwise                             | 2400 + 600      | 3000      | <= 2    | yes      |
 */

export type Tier = 'full' | 'lite' | 'frame' | 'poster';

export type PosterReason = 'save-data' | 'low-memory' | 'none';

/** Network Information API subset that this module reads (non-standard, Chromium only). */
export interface NetworkHints {
  readonly saveData?: boolean;
}

/** `Navigator` plus the two non-standard hints. Every real `Navigator` is assignable to it. */
export interface NavigatorWithHints extends Navigator {
  /** Approximate device memory in GB (Chromium only). */
  readonly deviceMemory?: number;
  readonly connection?: NetworkHints;
}

export interface SceneEnvironment {
  /** Viewport width in CSS px. */
  readonly width: number;
  readonly devicePixelRatio: number;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
  /** `navigator.deviceMemory`, or null when the browser does not report it. */
  readonly deviceMemoryGb: number | null;
}

export interface QualityProfile {
  readonly tier: Tier;
  readonly posterReason: PosterReason;
  /** False: draw one still frame (or nothing) and never loop. */
  readonly animate: boolean;
  readonly pointerParallax: boolean;
  /** Upper bound for the renderer pixel ratio. Always between 0 and 2 inclusive (Requirement 8.3). */
  readonly dprCap: number;
  readonly field: { readonly brainCount: number; readonly ambientCount: number };
  readonly links: { readonly maxLinks: number; readonly maxDegree: number };
}

/** Hard ceiling for the device pixel ratio of any Scene_3D renderer (Requirement 8.3). */
export const DPR_HARD_CAP = 2;
/** Below this width (CSS px) the scene is a Mobile_Viewport scene (Requirement 8.8). */
export const LITE_MAX_WIDTH_EXCLUSIVE = 768;
/** `deviceMemory` at or below this many GB selects the poster. */
export const LOW_MEMORY_GB = 2;

const DPR_CAP_FULL = 2;
const DPR_CAP_LITE = 1.5;
/** `degrade` lowers the pixel ratio cap to this value. */
const DPR_CAP_DEGRADED = 1;
/** `degrade` multiplies the particle and link counts by this factor. */
const DEGRADE_FACTOR = 0.6;

interface Budget {
  readonly brainCount: number;
  readonly ambientCount: number;
  readonly maxLinks: number;
  readonly maxDegree: number;
  readonly dprCap: number;
}

const BUDGET_FULL: Budget = { brainCount: 2400, ambientCount: 600, maxLinks: 3000, maxDegree: 6, dprCap: DPR_CAP_FULL };
const BUDGET_LITE: Budget = { brainCount: 600, ambientCount: 120, maxLinks: 500, maxDegree: 4, dprCap: DPR_CAP_LITE };

/** Pixel ratio actually requested: at least 1 (a zoomed-out page can report less), never above the cap. */
function capDpr(devicePixelRatio: number, tierCap: number): number {
  const requested = Number.isFinite(devicePixelRatio) && devicePixelRatio >= 1 ? devicePixelRatio : 1;
  return Math.min(requested, tierCap, DPR_HARD_CAP);
}

function posterReasonFor(env: SceneEnvironment): PosterReason {
  if (env.saveData) return 'save-data';
  if (env.deviceMemoryGb !== null && Number.isFinite(env.deviceMemoryGb) && env.deviceMemoryGb <= LOW_MEMORY_GB) {
    return 'low-memory';
  }
  return 'none';
}

/**
 * Chooses the tier and budget. Precedence: `poster`, then `frame`, then `lite`, then `full`.
 * Counts follow the width, so a reduced-motion phone gets the `lite` counts as a still frame.
 */
export function selectQuality(env: SceneEnvironment): QualityProfile {
  const posterReason = posterReasonFor(env);
  if (posterReason !== 'none') {
    return {
      tier: 'poster',
      posterReason,
      animate: false,
      pointerParallax: false,
      dprCap: DPR_CAP_DEGRADED,
      field: { brainCount: 0, ambientCount: 0 },
      links: { maxLinks: 0, maxDegree: 0 },
    };
  }

  const narrow = env.width < LITE_MAX_WIDTH_EXCLUSIVE;
  const budget = narrow ? BUDGET_LITE : BUDGET_FULL;
  const tier: Tier = env.reducedMotion ? 'frame' : narrow ? 'lite' : 'full';
  return {
    tier,
    posterReason: 'none',
    animate: tier === 'lite' || tier === 'full',
    pointerParallax: tier === 'full',
    dprCap: capDpr(env.devicePixelRatio, budget.dprCap),
    field: { brainCount: budget.brainCount, ambientCount: budget.ambientCount },
    links: { maxLinks: budget.maxLinks, maxDegree: budget.maxDegree },
  };
}

/**
 * One step down when the frame rate drops (used by `PerformanceMonitor onDecline`): counts times 0.6,
 * pixel ratio cap 1, pointer parallax off. The tier and the animate flag do not change.
 */
export function degrade(q: QualityProfile): QualityProfile {
  return {
    ...q,
    pointerParallax: false,
    dprCap: Math.min(q.dprCap, DPR_CAP_DEGRADED),
    field: {
      brainCount: Math.floor(q.field.brainCount * DEGRADE_FACTOR),
      ambientCount: Math.floor(q.field.ambientCount * DEGRADE_FACTOR),
    },
    links: {
      maxLinks: Math.floor(q.links.maxLinks * DEGRADE_FACTOR),
      maxDegree: q.links.maxDegree,
    },
  };
}

/** Reads the live inputs. Takes the window and navigator as arguments so tests can pass stand-ins. */
export function readSceneEnvironment(
  win: Pick<Window, 'innerWidth' | 'devicePixelRatio'>,
  nav: NavigatorWithHints,
  reducedMotion: boolean,
): SceneEnvironment {
  const memory = nav.deviceMemory;
  return {
    width: win.innerWidth,
    devicePixelRatio: win.devicePixelRatio,
    reducedMotion,
    saveData: nav.connection?.saveData === true,
    deviceMemoryGb: typeof memory === 'number' && Number.isFinite(memory) ? memory : null,
  };
}
