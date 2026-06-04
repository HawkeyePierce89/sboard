import type { CanvasKit } from 'canvaskit-wasm';
// `pixi.js-legacy` registers the Canvas renderer alongside the default
// WebGL one, which is required when constructing the Application with
// `forceCanvas: true`. The base `pixi.js` package alone throws
// "Unable to auto-detect a suitable renderer" in that mode.
import { Application, Container } from 'pixi.js-legacy';
import type { DisplayObject } from 'pixi.js';
import { walkContainer } from './pixi/scene-walker';
import { hitTest } from './skia/hit-test';
import {
  PixiToSkiaRenderer,
  colorToFloat4,
  defaultImageProvider,
  type ImageProvider,
} from './skia/renderer';
import type { Canvas, Surface } from './skia/types';

export type SkiaPointerEventKind = 'pointerdown' | 'pointerup';

export interface AppOptions {
  pixiApp: Application;
  canvasKit: CanvasKit;
  skiaSurface: Surface;
  renderer: PixiToSkiaRenderer;
  initialScene: Container;
  /**
   * Background color used to clear the Skia surface on every redraw.
   * The PIXI canvas is cleared by `Application` itself via its own
   * `backgroundColor`; we mirror that value here so both canvases
   * agree. Defaults to white (0xffffff).
   */
  backgroundColor?: number;
  /**
   * Optional DOM canvas to attach pointer listeners on. When provided,
   * `pointerdown` / `pointerup` events trigger a hit-test against the
   * current scene and emit synthetic `pointerdown` / `pointerup` events
   * on the matched `DisplayObject` — mirroring the Pixi canvas wiring
   * so the same handlers fire whichever canvas the user clicks/taps on.
   * Pointer events (rather than mouse events) cover touch and pen input
   * in addition to mouse, matching PIXI v7's native pointer listeners.
   */
  skiaCanvas?: HTMLCanvasElement;
  /**
   * Optional sprite-to-`Image` resolver. Stored on the App so callers
   * (e.g. the PDF exporter) can re-use the same cached provider that
   * the on-screen renderer uses, avoiding duplicate image uploads.
   */
  imageProvider?: ImageProvider;
}

/**
 * Owns the Pixi `Application`, the CanvasKit `Surface`, and the
 * `PixiToSkiaRenderer`. Exposes a minimal API:
 *   - `setScene(container)` swaps the root container on both canvases
 *   - `redrawSkia()` re-renders the current scene into the Skia surface
 *
 * The constructor takes already-resolved dependencies so the class is
 * unit-testable without booting a real CanvasKit WASM module or a real
 * PIXI renderer. The `createApp` factory below handles the runtime
 * wiring (called from `main.ts`).
 */
export class App {
  readonly pixiApp: Application;
  readonly canvasKit: CanvasKit;
  readonly skiaSurface: Surface;
  readonly renderer: PixiToSkiaRenderer;
  readonly skiaCanvas: HTMLCanvasElement | undefined;
  readonly imageProvider: ImageProvider | undefined;
  currentScene: Container;
  private readonly clearColor: Float32Array;

  constructor(opts: AppOptions) {
    this.pixiApp = opts.pixiApp;
    this.canvasKit = opts.canvasKit;
    this.skiaSurface = opts.skiaSurface;
    this.renderer = opts.renderer;
    this.currentScene = opts.initialScene;
    this.clearColor = colorToFloat4(opts.backgroundColor ?? 0xffffff, 1);
    this.skiaCanvas = opts.skiaCanvas;
    this.imageProvider = opts.imageProvider;

    this.pixiApp.stage.addChild(opts.initialScene);
    this.redrawSkia();

    if (this.skiaCanvas) {
      this.attachSkiaPointerListeners(this.skiaCanvas);
    }
  }

  setScene(container: Container): void {
    this.pixiApp.stage.removeChildren();
    this.currentScene = container;
    this.pixiApp.stage.addChild(container);
    this.redrawSkia();
  }

  redrawSkia(): void {
    const canvas: Canvas = this.skiaSurface.getCanvas();
    canvas.clear(this.clearColor);
    this.renderer.renderContainer(canvas, this.currentScene);
    this.skiaSurface.flush();
  }

  /**
   * Hit-test `(x, y)` against the current scene (coordinates in scene
   * space — i.e. CSS pixels relative to the canvas) and, if a leaf is
   * found, emit a synthetic Pixi event of the given kind on it. The
   * matched `DisplayObject` (or `null`) is returned so the caller can
   * update UI state.
   *
   * Re-walks the scene on every event rather than caching a tree — the
   * `SkiaSceneNode` builder is cheap, and avoiding a cache means the
   * hit-test sees current world matrices even when the user mutates
   * the scene between events (e.g. drag-to-move in a future task).
   */
  dispatchSkiaPointerEvent(
    kind: SkiaPointerEventKind,
    x: number,
    y: number,
  ): DisplayObject | null {
    const tree = walkContainer(this.currentScene);
    const hit = hitTest(tree, x, y);
    if (hit) {
      // The spec handlers (`g1 pointerdown!` / `g2 pointerup!`) ignore
      // the event payload, and Pixi's `emit` is typed for a real
      // `FederatedPointerEvent`. Cast to `never` to bypass the
      // mismatch — tests do the same when synthesising events.
      hit.emit(kind, makeSyntheticPointerEvent(kind, x, y) as never);
    }
    return hit;
  }

  private attachSkiaPointerListeners(canvas: HTMLCanvasElement): void {
    // Use Pointer Events (rather than Mouse Events) so touch and pen
    // input dispatch the same `pointerdown` / `pointerup` synthetic
    // events as mouse input — matches PIXI v7's native pointer wiring
    // on the Pixi canvas so both backends behave identically on
    // mobile / tablet hardware.
    canvas.addEventListener('pointerdown', (event) => {
      const { x, y } = canvasEventToScene(event, canvas);
      this.dispatchSkiaPointerEvent('pointerdown', x, y);
    });
    canvas.addEventListener('pointerup', (event) => {
      const { x, y } = canvasEventToScene(event, canvas);
      this.dispatchSkiaPointerEvent('pointerup', x, y);
    });
  }
}

/**
 * Translate a DOM `MouseEvent` (or `PointerEvent`, which extends it)
 * into scene-space coordinates relative to the canvas. Uses
 * `getBoundingClientRect()` rather than `offsetX/Y` so the math is
 * independent of `devicePixelRatio` — the scene operates in CSS pixels.
 */
export function canvasEventToScene(
  event: MouseEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function makeSyntheticPointerEvent(
  kind: SkiaPointerEventKind,
  x: number,
  y: number,
): { type: SkiaPointerEventKind; global: { x: number; y: number } } {
  return { type: kind, global: { x, y } };
}

export interface CreateAppOptions {
  pixiCanvas: HTMLCanvasElement;
  skiaCanvas: HTMLCanvasElement;
  canvasKit: CanvasKit;
  width: number;
  height: number;
  initialScene: Container;
  backgroundColor?: number;
  imageProvider?: ImageProvider;
}

export function createApp(opts: CreateAppOptions): App {
  const backgroundColor = opts.backgroundColor ?? 0xffffff;

  const skiaSurface = opts.canvasKit.MakeSWCanvasSurface(opts.skiaCanvas);
  if (!skiaSurface) {
    throw new Error(
      'Failed to create Skia software canvas surface: MakeSWCanvasSurface returned null',
    );
  }

  const pixiApp = new Application({
    view: opts.pixiCanvas,
    forceCanvas: true,
    width: opts.width,
    height: opts.height,
    backgroundColor,
  });

  // Build one provider per App so the on-screen renderer and the PDF
  // exporter share the same Image cache — otherwise every PDF export
  // would re-upload the texture pixels into CanvasKit.
  const imageProvider = opts.imageProvider ?? defaultImageProvider(opts.canvasKit);
  const renderer = new PixiToSkiaRenderer(opts.canvasKit, imageProvider);

  return new App({
    pixiApp,
    canvasKit: opts.canvasKit,
    skiaSurface,
    renderer,
    initialScene: opts.initialScene,
    backgroundColor,
    skiaCanvas: opts.skiaCanvas,
    imageProvider,
  });
}
