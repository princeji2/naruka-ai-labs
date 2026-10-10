/**
 * Scene_3D: the hero Particle_Constellation (React Three Fiber). Default export, loaded ONLY through a
 * dynamic `import()` by the island shell (`ConstellationIsland.tsx`, task 3.11), so `three`,
 * `@react-three/fiber` and `@react-three/drei` never enter the main payload.
 *
 * What it draws (look from `refrence/hero_section.md`, adapted):
 * - A brain-shaped cloud of outlined triangles plus sparse ambient triangles drifting at lower opacity
 *   (one `Points` draw call, triangle glyph and twinkle in the shader, driven by per-particle phases).
 * - A thin web of connecting lines between close brain particles (one `LineSegments` draw call, topology
 *   computed once because the whole group rotates rigidly).
 *
 * Colours: palette slot 0 `--accent`, 1 `--primary`, 2 `--secondary`, 3 `--text`, resolved at runtime
 * through the token bridge. They enter three.js with `Color.setRGB(r, g, b, SRGBColorSpace)` and the
 * shader ends with `#include <colorspace_fragment>`, so the output matches the CSS colour. No colour
 * literal exists in this file.
 *
 * Lifecycle (design sections 6 and 7): the render loop runs only while `shouldRun(...)` allows it
 * (`frameloop` is `demand` otherwise, with one `invalidate()` on resume). One `AbortController` owns
 * every listener (pointer, visibility, WebGL context events, matchMedia); the IntersectionObserver is
 * released through a `DisposableBag`. R3F disposes the JSX-created geometries and materials, the
 * renderer and the context on unmount. Written to survive React strict mode (mount, cleanup, mount).
 */
import { Canvas, useFrame, useThree, type CanvasProps } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import {
  AdditiveBlending,
  Color,
  SRGBColorSpace,
  type Group,
  type IUniform,
  type WebGLRendererParameters,
} from 'three';
import { PALETTE_SIZE, generateField, type ParticleField } from '../../lib/scene/brain-field.ts';
import { createDisposableBag } from '../../lib/scene/disposables.ts';
import { buildLinks } from '../../lib/scene/links.ts';
import { degrade, type QualityProfile } from '../../lib/scene/quality.ts';
import { shouldRun } from '../../lib/scene/run-state.ts';
import { scrollBridge } from '../../lib/scene/scroll-bridge.ts';
import { createTokenReader, type TokenName } from '../../lib/theme/tokens.ts';

export interface ConstellationSceneProps {
  readonly quality: QualityProfile;
}

// ---------------------------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------------------------

/** Palette slot to design token: 0 accent, 1 primary, 2 secondary, 3 text (matches brain-field.ts). */
const PALETTE_TOKENS: readonly TokenName[] = ['--accent', '--primary', '--secondary', '--text'];
const LINE_TOKEN: TokenName = '--secondary';

const FIELD_SEED = 20261010;
const AMBIENT_RADIUS = 3;

/** Link length for the full tier; sparser tiers scale it up so the web stays connected. */
const LINK_DISTANCE_FULL = 0.2;
const LINK_DISTANCE_MAX = 0.6;
const FULL_BRAIN_COUNT = 2400;
const LINE_OPACITY = 0.25;

/** Glyph size: `aSize * SIZE_SCALE * (REF_DISTANCE / distance)` in CSS px, then times the pixel ratio. */
const SIZE_SCALE = 4.2;
const SIZE_REFERENCE_HEIGHT = 560;
const SIZE_FACTOR_MIN = 0.7;
const SIZE_FACTOR_MAX = 1.4;
const CAMERA_DISTANCE = 6;

const BASE_YAW = 0.5;
const YAW_SPEED = 0.06;
const SCROLL_PITCH = 0.6;
const POINTER_YAW = 0.25;
const POINTER_PITCH = 0.15;
const POINTER_EASE = 4;
/** A long gap (tab resume, scrolled offscreen) must not make the scene jump. */
const MAX_FRAME_DELTA = 0.1;

/** PerformanceMonitor may decline repeatedly; stop degrading after this many steps. */
const MAX_DEGRADE_STEPS = 2;

const CAMERA_POSITION: [number, number, number] = [0, 0, CAMERA_DISTANCE];
const CAMERA: NonNullable<CanvasProps['camera']> = { fov: 45, position: CAMERA_POSITION };
const GL: WebGLRendererParameters = {
  antialias: false,
  alpha: true,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: true,
};
/** The scene ignores pointer events, so there is no need to re-measure the canvas on page scroll. */
const RESIZE: NonNullable<CanvasProps['resize']> = { scroll: false };
const CANVAS_STYLE = { pointerEvents: 'none' } as const;
const WRAPPER_STYLE = { width: '100%', height: '100%', pointerEvents: 'none' } as const;

// ---------------------------------------------------------------------------------------------
// Shaders (no colour literals: the palette arrives as a uniform)
// ---------------------------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform vec3 uPalette[${PALETTE_SIZE}];
attribute float aSize;
attribute float aPhase;
attribute float aColorIndex;
attribute float aAmbient;
varying vec3 vColor;
varying float vAlpha;
varying float vSize;

void main() {
  vec3 p = position;
  // Ambient particles drift a little; brain particles stay put so the connecting lines stay attached.
  p.x += aAmbient * 0.04 * cos(uTime * 0.30 + aPhase * 2.0);
  p.y += aAmbient * 0.05 * sin(uTime * 0.35 + aPhase * 3.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = aSize * uSizeScale * uPixelRatio * (${CAMERA_DISTANCE.toFixed(1)} / max(-mv.z, 0.1));
  gl_PointSize = size;
  vSize = size;

  float twinkle = 0.65 + 0.35 * sin(uTime * 1.4 + aPhase);
  vAlpha = twinkle * mix(1.0, 0.45, aAmbient);
  vColor = uPalette[int(aColorIndex + 0.5)];
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
varying float vSize;

// Signed distance to an equilateral triangle with side 2 (negative inside).
float sdTriangle(vec2 p) {
  const float k = 1.7320508;
  p.x = abs(p.x) - 1.0;
  p.y = p.y + 1.0 / k;
  if (p.x + k * p.y > 0.0) {
    p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;
  }
  p.x -= clamp(p.x, -2.0, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  if (vSize < 1.0) discard;
  vec2 q = vec2(gl_PointCoord.x * 2.0 - 1.0, 1.0 - gl_PointCoord.y * 2.0) * 1.25;
  q.y += 0.289; // centre the triangle's bounding box in the point sprite
  float d = sdTriangle(q);

  float unitsPerPx = 2.5 / vSize;
  float halfLine = 0.55 * uPixelRatio * unitsPerPx;
  float aa = 0.75 * unitsPerPx;
  float outline = 1.0 - smoothstep(halfLine - aa, halfLine + aa, abs(d));
  float fill = (1.0 - smoothstep(-aa, aa, d)) * 0.10;

  float a = max(outline, fill) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type PointUniforms = {
  uTime: IUniform<number>;
  uPixelRatio: IUniform<number>;
  uSizeScale: IUniform<number>;
  uPalette: IUniform<Color[]>;
};

interface Palette {
  readonly slots: readonly Color[];
  readonly line: Color;
}

/** Resolves the design tokens in the live document into three.js colours (sRGB in, working space out). */
function readPalette(doc: Document): Palette {
  const reader = createTokenReader(doc);
  const toColor = (name: TokenName): Color => {
    const { r, g, b } = reader.color(name);
    return new Color().setRGB(r, g, b, SRGBColorSpace);
  };
  return { slots: PALETTE_TOKENS.map(toColor), line: toColor(LINE_TOKEN) };
}

function linkDistance(brainCount: number): number {
  const scaled = LINK_DISTANCE_FULL * Math.sqrt(FULL_BRAIN_COUNT / Math.max(brainCount, 1));
  return Math.min(scaled, LINK_DISTANCE_MAX);
}

interface PointerState {
  x: number;
  y: number;
}

interface View {
  /** The profile last received from the island. */
  readonly source: QualityProfile;
  /** `source` after any PerformanceMonitor degrade steps. */
  readonly current: QualityProfile;
  readonly steps: number;
}

// ---------------------------------------------------------------------------------------------
// Scene content (inside <Canvas>)
// ---------------------------------------------------------------------------------------------

interface ParticlePointsProps {
  readonly field: ParticleField;
  readonly uniforms: PointUniforms;
}

function ParticlePoints({ field, uniforms }: ParticlePointsProps): ReactElement {
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[field.positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[field.sizes, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[field.phases, 1]} />
        <bufferAttribute attach="attributes-aColorIndex" args={[field.colorIndex, 1]} />
        <bufferAttribute attach="attributes-aAmbient" args={[field.ambient, 1]} />
      </bufferGeometry>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

interface ConnectingLinesProps {
  readonly positions: Float32Array;
  readonly links: Uint32Array;
  readonly color: Color;
}

function ConnectingLines({ positions, links, color }: ConnectingLinesProps): ReactElement {
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="index" args={[links, 1]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={LINE_OPACITY} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}

interface SceneContentProps {
  readonly field: ParticleField;
  readonly fieldKey: string;
  readonly links: Uint32Array;
  readonly palette: Palette;
  readonly uniforms: PointUniforms;
  readonly animate: boolean;
  readonly pointerParallax: boolean;
  readonly running: boolean;
  readonly contextLost: boolean;
  readonly pointer: RefObject<PointerState>;
  readonly onReady: () => void;
}

function SceneContent(props: SceneContentProps): ReactElement {
  const { field, fieldKey, links, palette, uniforms, animate, pointerParallax, running, contextLost, pointer, onReady } =
    props;
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<Group>(null);
  // Own clock: R3F resets its clock when `frameloop` flips, which would make the scene jump on resume.
  const elapsed = useRef(0);
  const eased = useRef<PointerState>({ x: 0, y: 0 });

  // First frame: ask for one render (this is the only frame in the `frame` tier), then report ready.
  useEffect(() => {
    invalidate();
    const id = requestAnimationFrame(onReady);
    return () => cancelAnimationFrame(id);
  }, [invalidate, onReady]);

  // One frame when the loop resumes or stops, and after a restored context or a changed field.
  useEffect(() => {
    if (!contextLost) invalidate();
  }, [running, contextLost, field, invalidate]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (group === null) return;
    const dt = Math.min(delta, MAX_FRAME_DELTA);
    if (animate) elapsed.current += dt;
    const t = animate ? elapsed.current : 0; // frame tier: t = 0

    const target = animate && pointerParallax ? pointer.current : { x: 0, y: 0 };
    const follow = 1 - Math.exp(-POINTER_EASE * dt);
    eased.current.x += (target.x - eased.current.x) * follow;
    eased.current.y += (target.y - eased.current.y) * follow;

    const scroll = animate ? scrollBridge.progress : 0;
    group.rotation.set(
      scroll * SCROLL_PITCH - eased.current.y * POINTER_PITCH,
      BASE_YAW + t * YAW_SPEED + eased.current.x * POINTER_YAW,
      0,
    );

    const sizeFactor = Math.min(
      SIZE_FACTOR_MAX,
      Math.max(SIZE_FACTOR_MIN, state.size.height / SIZE_REFERENCE_HEIGHT),
    );
    uniforms.uTime.value = t;
    uniforms.uPixelRatio.value = state.gl.getPixelRatio();
    uniforms.uSizeScale.value = SIZE_SCALE * sizeFactor;
  });

  return (
    <group ref={groupRef}>
      <ParticlePoints key={fieldKey} field={field} uniforms={uniforms} />
      {links.length > 0 ? (
        <ConnectingLines key={`${fieldKey}-${links.length}`} positions={field.positions} links={links} color={palette.line} />
      ) : null}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------------------------

export default function ConstellationScene({ quality }: ConstellationSceneProps): ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<PointerState>({ x: 0, y: 0 });

  const [view, setView] = useState<View>({ source: quality, current: quality, steps: 0 });
  let active = view;
  if (view.source !== quality) {
    // The island sent a new profile (for example a width change): restart from it.
    active = { source: quality, current: quality, steps: 0 };
    setView(active);
  }
  const current = active.current;

  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(() => document.visibilityState === 'hidden');
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [contextLost, setContextLost] = useState(false);

  const markReady = useCallback(() => setReady(true), []);
  const onDecline = useCallback(() => {
    setView((v) => (v.steps >= MAX_DEGRADE_STEPS ? v : { ...v, current: degrade(v.current), steps: v.steps + 1 }));
  }, []);

  // Colours from the design tokens. A missing token throws here and the island's error boundary keeps the poster.
  const palette = useMemo(() => readPalette(document), []);

  const uniforms = useMemo<PointUniforms>(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uSizeScale: { value: SIZE_SCALE },
      uPalette: { value: [...palette.slots] },
    }),
    [palette],
  );

  const { brainCount, ambientCount } = current.field;
  const { maxLinks, maxDegree } = current.links;
  const field = useMemo(
    () => generateField({ seed: FIELD_SEED, brainCount, ambientCount, ambientRadius: AMBIENT_RADIUS }),
    [brainCount, ambientCount],
  );
  const links = useMemo(
    () => buildLinks(field.positions, brainCount, { distance: linkDistance(brainCount), maxLinks, maxDegree }),
    [field, brainCount, maxLinks, maxDegree],
  );
  const fieldKey = `${brainCount}-${ambientCount}`;

  const initialParallax = useRef(quality.pointerParallax && quality.animate);

  // Every listener shares one AbortController; the observer is released through the bag.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return undefined;

    const controller = new AbortController();
    const { signal } = controller;
    const bag = createDisposableBag();
    const sceneElement: Element = wrapper.closest('.scene') ?? wrapper;

    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(
        (entries) => {
          const last = entries[entries.length - 1];
          if (last !== undefined) setInView(last.isIntersecting);
        },
        { threshold: 0, rootMargin: '100px' },
      );
      bag.track({ dispose: () => observer.disconnect() });
      observer.observe(sceneElement);
    } else {
      setInView(true);
    }

    const onVisibility = (): void => setDocumentHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility, { signal });
    onVisibility();

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onReduce = (): void => setReducedMotion(reduce.matches);
    reduce.addEventListener('change', onReduce, { signal });
    onReduce();

    // Context events do not bubble, so listen in the capture phase on the wrapper around the canvas.
    wrapper.addEventListener(
      'webglcontextlost',
      (event: Event) => {
        event.preventDefault(); // lets the browser restore the context
        if (!signal.aborted) setContextLost(true);
      },
      { capture: true, signal },
    );
    wrapper.addEventListener(
      'webglcontextrestored',
      () => {
        if (!signal.aborted) setContextLost(false);
      },
      { capture: true, signal },
    );

    if (initialParallax.current && window.matchMedia('(pointer: fine)').matches) {
      window.addEventListener(
        'pointermove',
        (event: PointerEvent) => {
          pointer.current.x = (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
          pointer.current.y = (event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1;
        },
        { passive: true, signal },
      );
      document.documentElement.addEventListener(
        'pointerleave',
        () => {
          pointer.current.x = 0;
          pointer.current.y = 0;
        },
        { signal },
      );
    }

    return () => {
      controller.abort();
      bag.disposeAll();
    };
  }, []);

  const running = shouldRun({
    ready,
    inView,
    documentHidden,
    reducedMotion,
    contextLost,
    animate: current.animate,
  });

  return (
    <div ref={wrapperRef} style={WRAPPER_STYLE}>
      {current.tier === 'poster' ? null : (
        <Canvas
          frameloop={running ? 'always' : 'demand'}
          dpr={[1, current.dprCap]}
          gl={GL}
          camera={CAMERA}
          resize={RESIZE}
          style={CANVAS_STYLE}
          flat
        >
          {current.animate ? <PerformanceMonitor onDecline={onDecline} /> : null}
          <SceneContent
            field={field}
            fieldKey={fieldKey}
            links={links}
            palette={palette}
            uniforms={uniforms}
            animate={current.animate}
            pointerParallax={current.pointerParallax}
            running={running}
            contextLost={contextLost}
            pointer={pointer}
            onReady={markReady}
          />
        </Canvas>
      )}
    </div>
  );
}
