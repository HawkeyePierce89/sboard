import type { CanvasKit } from 'canvaskit-wasm';
// `pixi.js-legacy` registers the Canvas renderer alongside the default
// WebGL one, which is required when constructing the Application with
// `forceCanvas: true`. The base `pixi.js` package alone throws
// "Unable to auto-detect a suitable renderer" in that mode.
import { Application, Container } from 'pixi.js-legacy';
import {
  PixiToSkiaRenderer,
  colorToFloat4,
  type ImageProvider,
} from './skia/renderer';
import type { Canvas, Surface } from './skia/types';

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
  currentScene: Container;
  private readonly clearColor: Float32Array;

  constructor(opts: AppOptions) {
    this.pixiApp = opts.pixiApp;
    this.canvasKit = opts.canvasKit;
    this.skiaSurface = opts.skiaSurface;
    this.renderer = opts.renderer;
    this.currentScene = opts.initialScene;
    this.clearColor = colorToFloat4(opts.backgroundColor ?? 0xffffff, 1);

    this.pixiApp.stage.addChild(opts.initialScene);
    this.redrawSkia();
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

  const renderer = new PixiToSkiaRenderer(opts.canvasKit, opts.imageProvider);

  return new App({
    pixiApp,
    canvasKit: opts.canvasKit,
    skiaSurface,
    renderer,
    initialScene: opts.initialScene,
    backgroundColor,
  });
}
