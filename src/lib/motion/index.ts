/**
 * Motion layer wiring: registers the built-in effects on the Scroll_Controller.
 * Call {@link registerBuiltInMotion} once, before or after `scrollController.init()`.
 */
import { scrollController } from '../scroll/index.ts';
import { CARD_TILT_KEY, cardTiltRegistration } from './card-tilt.ts';
import { readMotionTokens } from './config.ts';
import { HEADER_KEY, headerRegistration } from './header.ts';
import { MAGNETIC_KEY, magneticRegistration } from './magnetic.ts';
import { PARALLAX_KEY, parallaxRegistration } from './parallax.ts';
import { realMotionApi } from './real-api.ts';
import { SCENE_PROGRESS_KEY, sceneProgressRegistration } from './scene-progress.ts';
import { REVEAL_KEY, revealRegistration } from './reveal.ts';

export { MOTION_QUERIES } from './config.ts';
export type { MotionApi } from './api.ts';

export function registerBuiltInMotion(): void {
  scrollController.register(REVEAL_KEY, revealRegistration(realMotionApi, () => readMotionTokens()));
  scrollController.register(HEADER_KEY, headerRegistration(realMotionApi, () => readMotionTokens()));
  scrollController.register(CARD_TILT_KEY, cardTiltRegistration(realMotionApi));
  scrollController.register(PARALLAX_KEY, parallaxRegistration(realMotionApi));
  scrollController.register(SCENE_PROGRESS_KEY, sceneProgressRegistration(realMotionApi));
  scrollController.register(MAGNETIC_KEY, magneticRegistration(realMotionApi));
}
