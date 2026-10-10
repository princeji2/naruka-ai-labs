/**
 * Card tilt registration (design section 10.4).
 *
 * Runs only for `fullMotion && finePointer && desktop`. Every `.card` except `card-wide` and `card-compact`
 * (see {@link shouldTilt}; those keep the CSS lift) gets `data-tilt`, which tells the
 * CSS in `Card.astro` to stop writing `transform`; from then on this registration owns the card's
 * transform: the hover/focus lift (same numbers as the CSS fallback, read from the card's own
 * `--card-hover-lift` / `--card-hover-scale`), a tilt of at most +-5deg that follows the pointer
 * (`quickTo` on `rotationX` / `rotationY`, `transformPerspective` 900) and the press feedback.
 *
 * It also owns the document-level `pointermove` that feeds the `--mx` / `--my` cursor highlight, so
 * that listener goes away with the registration. One AbortController owns every listener; cleanup
 * aborts it, removes the attributes and custom properties, and clears the inline transform.
 *
 * Takes the {@link MotionApi} facade instead of GSAP, so a recorder can stand in for it. Nothing here
 * touches `document` at import time, so Node can import this file.
 */
import type { MotionFlags, MotionSetup } from '../scroll/scroll-controller.ts';
import type { MotionApi, TweenVars } from './api.ts';
import { formatCubicBezier, parseCubicBezier, parseDurationToken, parsePxToken, type CubicBezier } from './config.ts';

export const CARD_TILT_KEY = 'card-tilt';
export const TILT_ATTRIBUTE = 'data-tilt';

/**
 * Cards with one of these classes keep their CSS lift: no `data-tilt`, no rotation, no pointer
 * handling. Large containers (`card-wide`) and short notices (`card-compact`) must not rotate.
 */
export const TILT_SKIP_CLASSES = ['card-wide', 'card-compact'] as const;

/** Cards that tilt: every `.card` except the skipped variants. */
export const TILT_CARD_SELECTOR = `.card${TILT_SKIP_CLASSES.map((name) => `:not(.${name})`).join('')}`;

/** The skip rule without a browser: true when a card with these classes should tilt. */
export function shouldTilt(classList: { contains(token: string): boolean }): boolean {
  return classList.contains('card') && !TILT_SKIP_CLASSES.some((name) => classList.contains(name));
}

/** Largest rotation on either axis, in degrees. */
export const MAX_TILT_DEG = 5;
/** `transformPerspective` applied while a card is hovered. */
export const TILT_PERSPECTIVE = 900;
/** Matches `.card-linked:active` in Card.astro. */
const PRESS_SCALE = 0.99;

/** Used only if the card or root tokens cannot be read. They equal the Card.astro and tokens.css values. */
const FALLBACK = {
  liftPx: -6,
  scale: 1.02,
  durationS: 0.35,
  ease: [0.22, 1, 0.36, 1] as CubicBezier,
} as const;

export interface TiltAngles {
  readonly rotationX: number;
  readonly rotationY: number;
}

const clampUnit = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0);

/**
 * Maps a pointer position relative to the card centre (`nx`, `ny` in -1..1, right and down positive)
 * to rotation angles. Inputs outside -1..1 are clamped, so the result is always within +-{@link MAX_TILT_DEG}.
 */
export function tiltAngles(nx: number, ny: number): TiltAngles {
  // `+ 0` turns -0 into 0.
  return { rotationX: -clampUnit(ny) * MAX_TILT_DEG + 0, rotationY: clampUnit(nx) * MAX_TILT_DEG + 0 };
}

/** The registration only runs for full motion with a fine pointer at desktop width. */
export function tiltEnabled(flags: MotionFlags): boolean {
  return flags.fullMotion && !flags.reduced && flags.finePointer && flags.desktop;
}

interface Timing {
  readonly durationS: number;
  readonly ease: string;
}

interface CardState {
  readonly liftPx: number;
  readonly liftScale: number;
  /** Only linked cards have press feedback, like `.card-linked:active`. */
  readonly pressable: boolean;
  hovered: boolean;
  focused: boolean;
  pressed: boolean;
  rotateX: ((value: number) => void) | null;
  rotateY: ((value: number) => void) | null;
}

function readTiming(doc: Document): Timing {
  const view = doc.defaultView;
  if (view === null) return { durationS: FALLBACK.durationS, ease: formatCubicBezier(FALLBACK.ease) };
  const style = view.getComputedStyle(doc.documentElement);
  return {
    durationS: parseDurationToken(style.getPropertyValue('--motion-duration-card')) ?? FALLBACK.durationS,
    ease: formatCubicBezier(parseCubicBezier(style.getPropertyValue('--ease-card')) ?? FALLBACK.ease),
  };
}

function readCardState(card: HTMLElement, view: Window): CardState {
  const style = view.getComputedStyle(card);
  const scale = Number(style.getPropertyValue('--card-hover-scale').trim());
  return {
    liftPx: parsePxToken(style.getPropertyValue('--card-hover-lift')) ?? FALLBACK.liftPx,
    liftScale: Number.isFinite(scale) && scale > 0 ? scale : FALLBACK.scale,
    pressable: card.classList.contains('card-linked'),
    hovered: false,
    focused: false,
    pressed: false,
    rotateX: null,
    rotateY: null,
  };
}

/** Mouse and pen only: a touch that happens on a hybrid device never tilts. */
const isFineInput = (event: PointerEvent): boolean => event.pointerType === 'mouse' || event.pointerType === 'pen';

export function cardTiltRegistration(api: MotionApi, doc: Document = document): MotionSetup {
  return (flags) => {
    if (!tiltEnabled(flags)) return;
    const view = doc.defaultView;
    if (view === null) return;

    // The selector already excludes the skipped variants; the filter keeps the rule in one tested helper.
    const cards = api.select(TILT_CARD_SELECTOR).filter((card) => shouldTilt(card.classList));
    if (cards.length === 0) return;

    const timing = readTiming(doc);
    const abort = new AbortController();
    const { signal } = abort;
    const states = new Map<HTMLElement, CardState>();
    /** Cards that got an inline transform or highlight position and need cleaning up. */
    const animated = new Set<HTMLElement>();
    const highlighted = new Set<HTMLElement>();

    /** Moves a card to the pose its state asks for. Rotation only returns to 0 once the pointer has left. */
    const pose = (card: HTMLElement, state: CardState): void => {
      const raised = state.hovered || state.focused;
      const resting = !raised && !state.pressed;
      const target = state.pressed
        ? { y: 0, scale: PRESS_SCALE }
        : raised
          ? { y: state.liftPx, scale: state.liftScale }
          : { y: 0, scale: 1 };
      const vars: TweenVars = {
        ...target,
        ...(state.hovered ? {} : { rotationX: 0, rotationY: 0 }),
        ...(resting ? { clearProps: 'transform' } : {}),
        duration: timing.durationS,
        ease: timing.ease,
        overwrite: 'auto', // a reveal tween still running on y must not fight the lift
      };
      animated.add(card);
      api.to([card], vars);
    };

    const track = (card: HTMLElement, state: CardState, event: PointerEvent): void => {
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      if (width === 0 || height === 0) return;
      // Centre and untransformed size: the centre of the bounding box does not move when the card rotates or scales.
      const rect = card.getBoundingClientRect();
      const nx = (event.clientX - (rect.left + rect.width / 2)) / (width / 2);
      const ny = (event.clientY - (rect.top + rect.height / 2)) / (height / 2);
      const angles = tiltAngles(nx, ny);
      state.rotateX?.(angles.rotationX);
      state.rotateY?.(angles.rotationY);
    };

    for (const card of cards) {
      const state = readCardState(card, view);
      states.set(card, state);
      card.setAttribute(TILT_ATTRIBUTE, '');

      card.addEventListener(
        'pointerenter',
        (event) => {
          if (!isFineInput(event)) return;
          state.hovered = true;
          animated.add(card);
          api.set([card], { transformPerspective: TILT_PERSPECTIVE });
          const follow: TweenVars = { duration: timing.durationS, ease: timing.ease };
          state.rotateX = api.quickTo(card, 'rotationX', follow);
          state.rotateY = api.quickTo(card, 'rotationY', follow);
          pose(card, state);
          track(card, state, event);
        },
        { signal },
      );

      card.addEventListener(
        'pointerleave',
        (event) => {
          if (!isFineInput(event)) return;
          state.hovered = false;
          state.pressed = false;
          state.rotateX = null;
          state.rotateY = null;
          pose(card, state);
        },
        { signal },
      );

      card.addEventListener(
        'pointerdown',
        (event) => {
          if (!state.pressable || !isFineInput(event) || event.button !== 0) return;
          state.pressed = true;
          pose(card, state);
        },
        { signal },
      );

      const release = (): void => {
        if (!state.pressed) return;
        state.pressed = false;
        pose(card, state);
      };
      card.addEventListener('pointerup', release, { signal });
      card.addEventListener('pointercancel', release, { signal });

      // Keyboard focus lifts the card like hover does (the CSS focus lift is switched off by data-tilt).
      card.addEventListener(
        'focusin',
        (event) => {
          if (!(event.target instanceof Element) || !event.target.matches(':focus-visible')) return;
          state.focused = true;
          pose(card, state);
        },
        { signal },
      );
      card.addEventListener(
        'focusout',
        (event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && card.contains(next)) return;
          state.focused = false;
          pose(card, state);
        },
        { signal },
      );
    }

    // Cursor-following highlight (--mx / --my) and the tilt target, from one document-level listener.
    doc.addEventListener(
      'pointermove',
      (event) => {
        if (!isFineInput(event) || !(event.target instanceof Element)) return;
        const card = event.target.closest<HTMLElement>(TILT_CARD_SELECTOR);
        if (card === null) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        card.style.setProperty('--my', `${event.clientY - rect.top}px`);
        highlighted.add(card);
        const state = states.get(card);
        if (state !== undefined && state.hovered) track(card, state, event);
      },
      { passive: true, signal },
    );

    return () => {
      abort.abort();
      if (animated.size > 0) {
        // overwrite: true also stops a tween still running when the pointer left or the preference flipped.
        api.set([...animated], { clearProps: 'transform', overwrite: true });
      }
      for (const card of cards) card.removeAttribute(TILT_ATTRIBUTE);
      for (const card of highlighted) {
        card.style.removeProperty('--mx');
        card.style.removeProperty('--my');
      }
      states.clear();
      animated.clear();
      highlighted.clear();
    };
  };
}
