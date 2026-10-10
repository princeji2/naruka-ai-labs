/**
 * WebGL support probe (Requirement 8.9).
 *
 * `failIfMajorPerformanceCaveat` makes a software-rendered context fail creation, so a slow software
 * renderer counts as "unavailable". The probe context is released immediately so it does not count
 * against the browser's context limit.
 */

/** The part of `Document` this probe needs. */
export type CanvasFactory = Pick<Document, 'createElement'>;

const PROBE_OPTIONS: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };

export function detectWebGL(doc: CanvasFactory): boolean {
  try {
    const canvas = doc.createElement('canvas');
    const gl: WebGLRenderingContext | WebGL2RenderingContext | null =
      canvas.getContext('webgl2', PROBE_OPTIONS) ?? canvas.getContext('webgl', PROBE_OPTIONS);
    if (gl === null || gl.isContextLost()) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
