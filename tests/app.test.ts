import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Application, Container, Graphics } from 'pixi.js-legacy';
import type { CanvasKit } from 'canvaskit-wasm';
import { App, createApp } from '../src/app';
import { PixiToSkiaRenderer } from '../src/skia/renderer';
import type { Surface } from '../src/skia/types';

interface MockSkiaCanvas {
  clear: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  concat: ReturnType<typeof vi.fn>;
  drawPath: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

interface MockSkiaSurface {
  getCanvas: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  _canvas: MockSkiaCanvas;
}

function makeMockSurface(): MockSkiaSurface {
  const canvas: MockSkiaCanvas = {
    clear: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    concat: vi.fn(),
    drawPath: vi.fn(),
    drawImage: vi.fn(),
  };
  return {
    getCanvas: vi.fn(() => canvas),
    flush: vi.fn(),
    _canvas: canvas,
  };
}

function makeFakePixiApp(): Application {
  // A bare object with a real `stage` is enough — App only reads `.stage`
  // and never touches the renderer/ticker.
  return { stage: new Container() } as unknown as Application;
}

interface MockRenderer {
  renderContainer: ReturnType<typeof vi.fn>;
}

function makeMockRenderer(): MockRenderer {
  return { renderContainer: vi.fn() };
}

const fakeCanvasKit = {} as CanvasKit;

function buildApp(
  overrides: {
    pixiApp?: Application;
    skiaSurface?: MockSkiaSurface;
    renderer?: MockRenderer;
    initialScene?: Container;
    backgroundColor?: number;
  } = {},
): {
  app: App;
  pixiApp: Application;
  skiaSurface: MockSkiaSurface;
  renderer: MockRenderer;
  initialScene: Container;
} {
  const pixiApp = overrides.pixiApp ?? makeFakePixiApp();
  const skiaSurface = overrides.skiaSurface ?? makeMockSurface();
  const renderer = overrides.renderer ?? makeMockRenderer();
  const initialScene = overrides.initialScene ?? new Container();
  const app = new App({
    pixiApp,
    canvasKit: fakeCanvasKit,
    skiaSurface: skiaSurface as unknown as Surface,
    renderer: renderer as unknown as PixiToSkiaRenderer,
    initialScene,
    backgroundColor: overrides.backgroundColor,
  });
  return { app, pixiApp, skiaSurface, renderer, initialScene };
}

describe('App constructor — wiring', () => {
  it('exposes all injected dependencies as instance fields', () => {
    const pixiApp = makeFakePixiApp();
    const skiaSurface = makeMockSurface();
    const renderer = makeMockRenderer();
    const initialScene = new Container();

    const app = new App({
      pixiApp,
      canvasKit: fakeCanvasKit,
      skiaSurface: skiaSurface as unknown as Surface,
      renderer: renderer as unknown as PixiToSkiaRenderer,
      initialScene,
    });

    expect(app.pixiApp).toBe(pixiApp);
    expect(app.canvasKit).toBe(fakeCanvasKit);
    expect(app.skiaSurface).toBe(skiaSurface);
    expect(app.renderer).toBe(renderer);
    expect(app.currentScene).toBe(initialScene);
  });

  it('adds the initial scene to the pixi stage so PIXI renders it', () => {
    const { pixiApp, initialScene } = buildApp();
    expect(pixiApp.stage.children).toContain(initialScene);
  });

  it('triggers an immediate Skia redraw (clear → render → flush)', () => {
    const { skiaSurface, renderer, initialScene } = buildApp();

    expect(skiaSurface.getCanvas).toHaveBeenCalledTimes(1);
    expect(skiaSurface._canvas.clear).toHaveBeenCalledTimes(1);
    expect(renderer.renderContainer).toHaveBeenCalledTimes(1);
    expect(renderer.renderContainer.mock.calls[0][0]).toBe(skiaSurface._canvas);
    expect(renderer.renderContainer.mock.calls[0][1]).toBe(initialScene);
    expect(skiaSurface.flush).toHaveBeenCalledTimes(1);
  });

  it('clears with white (1,1,1,1) by default', () => {
    const { skiaSurface } = buildApp();
    const clearArg = skiaSurface._canvas.clear.mock.calls[0][0] as Float32Array;
    expect(Array.from(clearArg)).toEqual([1, 1, 1, 1]);
  });

  it('clears with the explicit backgroundColor when provided', () => {
    const { skiaSurface } = buildApp({ backgroundColor: 0xff0000 });
    const clearArg = skiaSurface._canvas.clear.mock.calls[0][0] as Float32Array;
    expect(Array.from(clearArg)).toEqual([1, 0, 0, 1]);
  });
});

describe('App.setScene', () => {
  it('updates currentScene to the new container', () => {
    const { app } = buildApp();
    const next = new Container();
    app.setScene(next);
    expect(app.currentScene).toBe(next);
  });

  it('removes the previous scene from the pixi stage and adds the new one', () => {
    const { app, pixiApp, initialScene } = buildApp();
    const next = new Container();
    app.setScene(next);
    expect(pixiApp.stage.children).not.toContain(initialScene);
    expect(pixiApp.stage.children).toContain(next);
    expect(pixiApp.stage.children).toHaveLength(1);
  });

  it('redraws Skia after the swap (clear/render/flush each invoked again)', () => {
    const { app, skiaSurface, renderer } = buildApp();
    const next = new Container();
    app.setScene(next);
    expect(skiaSurface._canvas.clear).toHaveBeenCalledTimes(2);
    expect(renderer.renderContainer).toHaveBeenCalledTimes(2);
    expect(renderer.renderContainer.mock.calls[1][1]).toBe(next);
    expect(skiaSurface.flush).toHaveBeenCalledTimes(2);
  });

  it('refreshes both canvases when the scene contains real graphics', () => {
    const { app, pixiApp } = buildApp();
    const next = new Container();
    const g = new Graphics();
    g.beginFill(0x00ff00, 1).drawRect(0, 0, 10, 10).endFill();
    next.addChild(g);

    app.setScene(next);

    expect(app.currentScene).toBe(next);
    expect(pixiApp.stage.children).toEqual([next]);
  });
});

describe('App.redrawSkia', () => {
  it('clears, renders the current scene, and flushes in that order', () => {
    const { app, skiaSurface, renderer, initialScene } = buildApp();
    skiaSurface._canvas.clear.mockClear();
    renderer.renderContainer.mockClear();
    skiaSurface.flush.mockClear();

    app.redrawSkia();

    expect(skiaSurface._canvas.clear).toHaveBeenCalledTimes(1);
    expect(renderer.renderContainer).toHaveBeenCalledTimes(1);
    expect(renderer.renderContainer.mock.calls[0][1]).toBe(initialScene);
    expect(skiaSurface.flush).toHaveBeenCalledTimes(1);

    const clearOrder = skiaSurface._canvas.clear.mock.invocationCallOrder[0];
    const renderOrder = renderer.renderContainer.mock.invocationCallOrder[0];
    const flushOrder = skiaSurface.flush.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(renderOrder);
    expect(renderOrder).toBeLessThan(flushOrder);
  });

  it('passes the surface canvas (not a fresh one) to the renderer', () => {
    const { app, skiaSurface, renderer } = buildApp();
    renderer.renderContainer.mockClear();
    app.redrawSkia();
    expect(renderer.renderContainer.mock.calls[0][0]).toBe(skiaSurface._canvas);
  });
});

describe('createApp', () => {
  let mockSurface: MockSkiaSurface;
  let canvasKit: CanvasKit;
  let pixiCanvas: HTMLCanvasElement;
  let skiaCanvas: HTMLCanvasElement;

  beforeEach(() => {
    mockSurface = makeMockSurface();
    pixiCanvas = document.createElement('canvas');
    pixiCanvas.width = 500;
    pixiCanvas.height = 400;
    skiaCanvas = document.createElement('canvas');
    skiaCanvas.width = 500;
    skiaCanvas.height = 400;
    canvasKit = {
      MakeSWCanvasSurface: vi.fn(() => mockSurface),
    } as unknown as CanvasKit;
  });

  it('throws a descriptive error when MakeSWCanvasSurface returns null', () => {
    const ckNull = {
      MakeSWCanvasSurface: vi.fn(() => null),
    } as unknown as CanvasKit;

    expect(() =>
      createApp({
        pixiCanvas,
        skiaCanvas,
        canvasKit: ckNull,
        width: 500,
        height: 400,
        initialScene: new Container(),
      }),
    ).toThrowError(/MakeSWCanvasSurface returned null/);
  });

  it('calls MakeSWCanvasSurface with the skia canvas element before touching PIXI', () => {
    const ck = {
      MakeSWCanvasSurface: vi.fn(() => {
        throw new Error('stop here');
      }),
    } as unknown as CanvasKit;

    expect(() =>
      createApp({
        pixiCanvas,
        skiaCanvas,
        canvasKit: ck,
        width: 500,
        height: 400,
        initialScene: new Container(),
      }),
    ).toThrow('stop here');

    expect(ck.MakeSWCanvasSurface).toHaveBeenCalledWith(skiaCanvas);
  });

  it('returns an App wired with the CanvasKit surface and the supplied initialScene', () => {
    // Keep the scene empty so the inner `PixiToSkiaRenderer` only needs
    // canvas.save/concat/restore from the mock surface (no Paint /
    // PathBuilder constructors on the CanvasKit stub).
    const initialScene = new Container();

    const app = createApp({
      pixiCanvas,
      skiaCanvas,
      canvasKit,
      width: 500,
      height: 400,
      initialScene,
    });

    expect(canvasKit.MakeSWCanvasSurface).toHaveBeenCalledWith(skiaCanvas);
    expect(app.canvasKit).toBe(canvasKit);
    expect(app.skiaSurface).toBe(mockSurface);
    expect(app.currentScene).toBe(initialScene);
    expect(app.pixiApp).toBeInstanceOf(Application);
    expect(app.pixiApp.stage.children).toContain(initialScene);

    // Surface was redrawn on construction, with the white clear color.
    expect(mockSurface._canvas.clear).toHaveBeenCalledTimes(1);
    expect(mockSurface.flush).toHaveBeenCalledTimes(1);

    // Cleanup so subsequent tests don't share PIXI globals.
    app.pixiApp.destroy(false);
  });
});
