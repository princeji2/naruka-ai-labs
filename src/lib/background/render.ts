/**
 * Canvas-2D drawing for the Background_Component.
 *
 * Colours are passed in by the caller, already resolved through the token bridge
 * (`src/lib/theme/tokens.ts`): particles use `--accent`, links and strokes use `--secondary`.
 * This file holds no colour value. It uses DOM types only, never DOM globals, so Node can import it.
 */
import { formatRgb, type Rgba } from '../theme/color.ts';
import type { BackgroundConfig, Bounds, Particle, Point } from './particle-field.ts';

export interface BackgroundPalette {
  /** Particle fill (`--accent`). */
  readonly particle: Rgba;
  /** Link and grab lines (`--secondary`). */
  readonly link: Rgba;
  /** Particle outline (`--secondary`). */
  readonly stroke: Rgba;
}

/** Linear fade used by the reference: full opacity at distance 0, none at `limit`. */
export function fadeWithDistance(maxOpacity: number, distance: number, limit: number): number {
  if (!(limit > 0) || !(distance >= 0) || distance > limit) return 0;
  return maxOpacity * (1 - distance / limit);
}

/**
 * Sizes the canvas backing store to the CSS size times `dpr`, and scales the context so drawing
 * code keeps working in CSS px. Returns the CSS bounds.
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Bounds {
  const width = Math.max(Math.floor(cssWidth), 0);
  const height = Math.max(Math.floor(cssHeight), 0);
  canvas.width = Math.max(Math.round(width * dpr), 1);
  canvas.height = Math.max(Math.round(height * dpr), 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/**
 * Draws one frame: clears the canvas, then the links between near particles, the grab lines from the
 * pointer to near particles (when `pointer` is not null), and the particles themselves.
 * Coordinates are CSS px; the caller has already applied the device-pixel-ratio transform.
 */
export function drawField(
  ctx: CanvasRenderingContext2D,
  ps: readonly Particle[],
  bounds: Bounds,
  palette: BackgroundPalette,
  cfg: BackgroundConfig,
  pointer: Point | null,
): void {
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, bounds.width, bounds.height);

  // Links between particles.
  const linkColour = formatRgb({ ...palette.link, a: 1 });
  const linkScale = palette.link.a;
  ctx.strokeStyle = linkColour;
  ctx.lineWidth = cfg.linkWidth;
  const reach = cfg.linkDistance;
  for (let i = 0; i < ps.length; i += 1) {
    const a = ps[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < ps.length; j += 1) {
      const b = ps[j];
      if (b === undefined) continue;
      const dx = a.x - b.x;
      if (dx > reach || dx < -reach) continue;
      const dy = a.y - b.y;
      if (dy > reach || dy < -reach) continue;
      const alpha = fadeWithDistance(cfg.linkOpacity, Math.hypot(dx, dy), reach) * linkScale;
      if (alpha > 0) strokeLine(ctx, a.x, a.y, b.x, b.y, alpha);
    }
  }

  // Hover grab: lines from the pointer to particles within grab distance.
  if (pointer !== null) {
    for (const p of ps) {
      const alpha = fadeWithDistance(cfg.grabLinkOpacity, Math.hypot(p.x - pointer.x, p.y - pointer.y), cfg.grabDistance) * linkScale;
      if (alpha > 0) strokeLine(ctx, p.x, p.y, pointer.x, pointer.y, alpha);
    }
  }

  // Particles: fill with the accent, outline with the secondary.
  ctx.fillStyle = formatRgb({ ...palette.particle, a: 1 });
  ctx.strokeStyle = formatRgb({ ...palette.stroke, a: 1 });
  ctx.lineWidth = cfg.strokeWidth;
  for (const p of ps) {
    ctx.globalAlpha = p.a * palette.particle.a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    if (cfg.strokeWidth > 0) {
      ctx.globalAlpha = p.a * palette.stroke.a;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Clears the canvas, for example when the background is torn down. */
export function clearField(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, bounds.width, bounds.height);
}
