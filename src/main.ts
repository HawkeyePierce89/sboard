import { App, createApp } from './app';
import { buildInitialScene } from './pixi/initial-scene';
import { initCanvasKit } from './skia/canvaskit-loader';
import { configureCanvasForDPR, getCanvasById } from './ui/dom';

export const APP_NAME = 'sboard';

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 400;

export function bootstrap(): void {
  if (typeof document !== 'undefined') {
    document.title = APP_NAME;
  }
}

/**
 * Browser entry: load CanvasKit, build the spec scene, and instantiate
 * the `App`. Kept separate from `bootstrap` so unit tests can import the
 * module without triggering WASM loads / DOM lookups.
 */
export async function start(): Promise<App> {
  bootstrap();
  const pixiCanvas = getCanvasById('pixi-canvas');
  const skiaCanvas = getCanvasById('skia-canvas');

  configureCanvasForDPR(pixiCanvas, CANVAS_WIDTH, CANVAS_HEIGHT);
  configureCanvasForDPR(skiaCanvas, CANVAS_WIDTH, CANVAS_HEIGHT);

  const canvasKit = await initCanvasKit();
  return createApp({
    pixiCanvas,
    skiaCanvas,
    canvasKit,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    initialScene: buildInitialScene(),
  });
}

// Auto-run in the browser only when the expected canvases are present.
// Unit tests import this module in jsdom without the live DOM, so they
// stay quiet — the smoke test still calls `bootstrap()` directly.
if (
  typeof document !== 'undefined' &&
  document.getElementById('pixi-canvas') !== null
) {
  void start();
}
