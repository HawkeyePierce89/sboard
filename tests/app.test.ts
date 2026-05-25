import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Application, Container, Graphics } from 'pixi.js-legacy';
import type { CanvasKit } from 'canvaskit-wasm';
import { App, canvasEventToScene, createApp } from '../src/app';
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
    skiaCanvas?: HTMLCanvasElement;
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
    skiaCanvas: overrides.skiaCanvas,
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

    // A default imageProvider is built so sprites render without the
    // caller having to wire CanvasKit's MakeImageFromCanvasImageSource
    // manually. The PDF exporter re-uses this same instance via the
    // exposed `imageProvider` field.
    expect(typeof app.imageProvider).toBe('function');

    // Surface was redrawn on construction, with the white clear color.
    expect(mockSurface._canvas.clear).toHaveBeenCalledTimes(1);
    expect(mockSurface.flush).toHaveBeenCalledTimes(1);

    // Cleanup so subsequent tests don't share PIXI globals.
    app.pixiApp.destroy(false);
  });

  it('forwards an explicit imageProvider through to the App', () => {
    const initialScene = new Container();
    const imageProvider = vi.fn(() => null);

    const app = createApp({
      pixiCanvas,
      skiaCanvas,
      canvasKit,
      width: 500,
      height: 400,
      initialScene,
      imageProvider,
    });

    expect(app.imageProvider).toBe(imageProvider);
    app.pixiApp.destroy(false);
  });
});

describe('App.dispatchSkiaPointerEvent', () => {
  function sceneWithRect(name: string, x: number, y: number, w: number, h: number): {
    scene: Container;
    target: Graphics;
  } {
    const scene = new Container();
    const target = new Graphics();
    target.name = name;
    target.beginFill(0xff0000, 1).drawRect(x, y, w, h).endFill();
    scene.addChild(target);
    return { scene, target };
  }

  it('emits a pointerdown on the hit DisplayObject and returns it', () => {
    const { scene, target } = sceneWithRect('g-hit', 10, 10, 100, 100);
    const { app } = buildApp({ initialScene: scene });
    const listener = vi.fn();
    target.on('pointerdown', listener);

    const result = app.dispatchSkiaPointerEvent('pointerdown', 50, 50);

    expect(result).toBe(target);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0];
    expect(event).toMatchObject({ type: 'pointerdown', global: { x: 50, y: 50 } });
  });

  it('emits a pointerup on the hit DisplayObject (different kind)', () => {
    const { scene, target } = sceneWithRect('g-up', 0, 0, 80, 80);
    const { app } = buildApp({ initialScene: scene });
    const listener = vi.fn();
    target.on('pointerup', listener);

    const result = app.dispatchSkiaPointerEvent('pointerup', 40, 40);

    expect(result).toBe(target);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ type: 'pointerup' });
  });

  it('returns null and emits nothing when the point misses every shape', () => {
    const { scene, target } = sceneWithRect('g-miss', 10, 10, 50, 50);
    const { app } = buildApp({ initialScene: scene });
    const listener = vi.fn();
    target.on('pointerdown', listener);

    const result = app.dispatchSkiaPointerEvent('pointerdown', 500, 500);

    expect(result).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('honours the spec example: a click in the subContainer hits g3 / g4', () => {
    const scene = new Container();
    const sub = new Container();
    sub.position.set(75, 50);
    const g3 = new Graphics();
    g3.name = 'g3';
    g3.lineStyle(10, 0xffffff, 1).moveTo(0, 0).lineTo(150, 100);
    sub.addChild(g3);
    scene.addChild(sub);
    const { app } = buildApp({ initialScene: scene });

    const downListener = vi.fn();
    g3.on('pointerdown', downListener);

    // World midpoint of g3's segment = (75 + 75, 50 + 50) = (150, 100).
    const result = app.dispatchSkiaPointerEvent('pointerdown', 150, 100);

    expect(result).toBe(g3);
    expect(downListener).toHaveBeenCalledTimes(1);
  });

  it('re-walks the scene per event so changes after construction are seen', () => {
    const scene = new Container();
    const { app } = buildApp({ initialScene: scene });

    // No children yet — nothing to hit.
    expect(app.dispatchSkiaPointerEvent('pointerdown', 50, 50)).toBeNull();

    // Add a graphics after the App is built.
    const g = new Graphics();
    g.beginFill(0x00ff00, 1).drawRect(0, 0, 100, 100).endFill();
    scene.addChild(g);
    const listener = vi.fn();
    g.on('pointerdown', listener);

    const result = app.dispatchSkiaPointerEvent('pointerdown', 50, 50);
    expect(result).toBe(g);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not require a skiaCanvas — programmatic dispatch works without DOM wiring', () => {
    const { scene, target } = sceneWithRect('g-no-dom', 0, 0, 10, 10);
    const { app } = buildApp({ initialScene: scene });
    // No `skiaCanvas` was supplied, so no listeners were attached, but
    // the public dispatch method must still work.
    const listener = vi.fn();
    target.on('pointerdown', listener);

    expect(app.dispatchSkiaPointerEvent('pointerdown', 5, 5)).toBe(target);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('App — DOM listeners on the Skia canvas', () => {
  function makeCanvasAt(x: number, y: number, w: number, h: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    // jsdom returns zero-rects by default; stub so canvasEventToScene
    // produces stable coords.
    canvas.getBoundingClientRect = () =>
      ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) } as DOMRect);
    return canvas;
  }

  it('attaches mousedown/mouseup listeners when skiaCanvas is provided', () => {
    const canvas = makeCanvasAt(0, 0, 500, 400);
    const spy = vi.spyOn(canvas, 'addEventListener');

    buildApp({ skiaCanvas: canvas });

    const kinds = spy.mock.calls.map((c) => c[0]);
    expect(kinds).toContain('mousedown');
    expect(kinds).toContain('mouseup');
  });

  it('does NOT attach listeners when skiaCanvas is omitted', () => {
    // We can't easily spy on a non-existent canvas, but we can assert
    // the public surface stays clean: constructing without a canvas
    // must not throw and the field must be undefined.
    const { app } = buildApp();
    expect(app.skiaCanvas).toBeUndefined();
  });

  it('dispatches pointerdown on the hit object when the user clicks the Skia canvas', () => {
    const canvas = makeCanvasAt(0, 0, 500, 400);
    const scene = new Container();
    const target = new Graphics();
    target.beginFill(0xff0000, 1).drawRect(50, 50, 100, 100).endFill();
    scene.addChild(target);
    const listener = vi.fn();
    target.on('pointerdown', listener);

    buildApp({ initialScene: scene, skiaCanvas: canvas });

    const event = new MouseEvent('mousedown', {
      bubbles: true,
      clientX: 75,
      clientY: 75,
    });
    canvas.dispatchEvent(event);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subtracts the canvas getBoundingClientRect offset before hit-testing', () => {
    const canvas = makeCanvasAt(200, 100, 500, 400);
    const scene = new Container();
    const target = new Graphics();
    target.beginFill(0xff0000, 1).drawRect(0, 0, 100, 100).endFill();
    scene.addChild(target);
    const listener = vi.fn();
    target.on('pointerup', listener);

    buildApp({ initialScene: scene, skiaCanvas: canvas });

    // clientX=250, clientY=150 ⇒ canvas-local (50, 50), inside the rect.
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 250, clientY: 150 }));
    expect(listener).toHaveBeenCalledTimes(1);

    // clientX=199 (just left of the canvas) ⇒ local (-1, 0), outside.
    listener.mockClear();
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 199, clientY: 150 }));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('canvasEventToScene', () => {
  it('returns (clientX - rect.left, clientY - rect.top)', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () =>
      ({
        left: 30,
        top: 40,
        right: 530,
        bottom: 440,
        width: 500,
        height: 400,
        x: 30,
        y: 40,
        toJSON: () => ({}),
      }) as DOMRect;

    const event = new MouseEvent('mousedown', { clientX: 80, clientY: 100 });
    expect(canvasEventToScene(event, canvas)).toEqual({ x: 50, y: 60 });
  });
});
