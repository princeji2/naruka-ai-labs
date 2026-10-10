/**
 * Quality budget for the Background_Component: device-pixel-ratio cap, particle cap and pointer features.
 *
 * Pure apart from {@link readQualityInput}, which takes the window as an argument, so Node can import
 * this module. The media queries come from the scroll controller so they have one source of truth.
 */
import { MOTION_QUERIES } from '../scroll/scroll-controller.ts';
import { configFor, type BackgroundConfig } from './particle-field.ts';

/** Device pixel ratio cap on desktop (Requirement 8.3 style cap). */
export const DPR_CAP_DESKTOP = 2;
/** Device pixel ratio cap on a Mobile_Viewport. */
export const DPR_CAP_MOBILE = 1.5;

/** Mobile_Viewport: narrower than 768px. */
export const MOBILE_QUERY = MOTION_QUERIES.mobile;
/** Hover grab and click push run only for a fine, hovering pointer. */
export const POINTER_QUERY = MOTION_QUERIES.finePointer;

export interface QualityInput {
  readonly devicePixelRatio: number;
  readonly mobile: boolean;
  readonly finePointer: boolean;
  readonly reducedMotion: boolean;
}

export interface QualityProfile {
  /** Device pixel ratio to size the canvas with: at least 1, at most the cap. */
  readonly dpr: number;
  /** Simulation config for this viewport (carries the particle cap). */
  readonly config: BackgroundConfig;
  /** Hover grab and click push enabled. */
  readonly pointerFeatures: boolean;
  /** False under Reduced_Motion_Mode: draw one static frame, then stop. */
  readonly animate: boolean;
}

/** Caps the pixel ratio at 2 (1.5 on a Mobile_Viewport). Invalid values count as 1. */
export function capDevicePixelRatio(dpr: number, mobile: boolean): number {
  const cap = mobile ? DPR_CAP_MOBILE : DPR_CAP_DESKTOP;
  const value = Number.isFinite(dpr) && dpr >= 1 ? dpr : 1;
  return Math.min(value, cap);
}

export function resolveQuality(input: QualityInput): QualityProfile {
  return {
    dpr: capDevicePixelRatio(input.devicePixelRatio, input.mobile),
    config: configFor(input.mobile),
    pointerFeatures: input.finePointer && !input.reducedMotion,
    animate: !input.reducedMotion,
  };
}

/** Reads the live inputs from a window (or a stand-in with the same two members). */
export function readQualityInput(win: Pick<Window, 'devicePixelRatio' | 'matchMedia'>): QualityInput {
  return {
    devicePixelRatio: win.devicePixelRatio,
    mobile: win.matchMedia(MOBILE_QUERY).matches,
    finePointer: win.matchMedia(POINTER_QUERY).matches,
    reducedMotion: win.matchMedia(MOTION_QUERIES.reduced).matches,
  };
}
