import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { CanvasKit, Image } from 'canvaskit-wasm';
import {
  PixiToSkiaRenderer,
  colorToFloat4,
  defaultImageProvider,
  invertMatrix2D,
  pixiMatrixToSkia,
} from '../../src/skia/renderer';
import type { Canvas as SkCanvas } from '../../src/skia/types';
import type { SkiaSceneNode } from '../../src/pixi/scene-walker';
import type { Matrix2D } from '../../src/pixi/transform';

interface SpyPaint {
  setStyle: ReturnType<typeof vi.fn>;
  setColor: ReturnType<typeof vi.fn>;
  setStrokeWidth: ReturnType<typeof vi.fn>;
  setAntiAlias: ReturnType<typeof vi.fn>;
  setAlphaf: ReturnType<typeof vi.fn>;
  setColorFilter: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  _kind: 'paint';
  _id: number;
}

interface SpyPath {
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  addRect: ReturnType<typeof vi.fn>;
  addOval: ReturnType<typeof vi.fn>;
  addCircle: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  _kind: 'path';
  _id: number;
}

interface SpyCanvas {
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  concat: ReturnType<typeof vi.fn>;
  drawPath: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  drawImageRect: ReturnType<typeof vi.fn>;
}

interface SpyColorFilter {
  _kind: 'colorFilter';
  color: Float32Array;
  mode: unknown;
  delete: ReturnType<typeof vi.fn>;
}

interface MockCanvasKit {
  ck: CanvasKit;
  paints: SpyPaint[];
  paths: SpyPath[];
  colorFilters: SpyColorFilter[];
  fill: 'FILL';
  stroke: 'STROKE';
  modulate: 'MODULATE';
}

function makeMockCanvasKit(): MockCanvasKit {
  const paints: SpyPaint[] = [];
  const paths: SpyPath[] = [];
  const colorFilters: SpyColorFilter[] = [];

  const PaintCtor = vi.fn(function (): SpyPaint {
    const paint: SpyPaint = {
      setStyle: vi.fn(),
      setColor: vi.fn(),
      setStrokeWidth: vi.fn(),
      setAntiAlias: vi.fn(),
      setAlphaf: vi.fn(),
      setColorFilter: vi.fn(),
      delete: vi.fn(),
      _kind: 'paint',
      _id: paints.length,
    };
    paints.push(paint);
    return paint;
  });

  const PathCtor = vi.fn(function (): SpyPath {
    const path: SpyPath = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      addRect: vi.fn(),
      addOval: vi.fn(),
      addCircle: vi.fn(),
      close: vi.fn(),
      delete: vi.fn(),
      _kind: 'path',
      _id: paths.length,
    };
    // chainable
    path.moveTo.mockReturnValue(path);
    path.lineTo.mockReturnValue(path);
    path.addRect.mockReturnValue(path);
    path.addOval.mockReturnValue(path);
    path.addCircle.mockReturnValue(path);
    path.close.mockReturnValue(path);
    paths.push(path);
    return path;
  });

  const ck = {
    Paint: PaintCtor,
    Path: PathCtor,
    PaintStyle: { Fill: 'FILL', Stroke: 'STROKE' },
    BlendMode: { Modulate: 'MODULATE' },
    ColorFilter: {
      MakeBlend: vi.fn((color: Float32Array, mode: unknown) => {
        const filter: SpyColorFilter = {
          _kind: 'colorFilter',
          color,
          mode,
          delete: vi.fn(),
        };
        colorFilters.push(filter);
        return filter;
      }),
    },
    XYWHRect: (x: number, y: number, w: number, h: number) =>
      [x, y, x + w, y + h] as unknown,
    LTRBRect: (l: number, t: number, r: number, b: number) =>
      [l, t, r, b] as unknown,
  } as unknown as CanvasKit;

  return {
    ck,
    paints,
    paths,
    colorFilters,
    fill: 'FILL',
    stroke: 'STROKE',
    modulate: 'MODULATE',
  };
}

function makeMockCanvas(): SpyCanvas {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    concat: vi.fn(),
    drawPath: vi.fn(),
    drawImage: vi.fn(),
    drawImageRect: vi.fn(),
  };
}

function castCanvas(c: SpyCanvas): SkCanvas {
  return c as unknown as SkCanvas;
}

function callOrder(...spies: Array<{ name: string; spy: ReturnType<typeof vi.fn> }>): string[] {
  const calls: { name: string; order: number }[] = [];
  for (const { name, spy } of spies) {
    for (const invocation of spy.mock.invocationCallOrder) {
      calls.push({ name, order: invocation });
    }
  }
  calls.sort((a, b) => a.order - b.order);
  return calls.map((c) => c.name);
}

describe('pixiMatrixToSkia', () => {
  it('converts a PIXI [a,b,c,d,tx,ty] matrix into a 3x3 row-major Skia matrix', () => {
    expect(pixiMatrixToSkia([1, 0, 0, 1, 0, 0])).toEqual([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]);
  });

  it('places translation into the third column of the first two rows', () => {
    expect(pixiMatrixToSkia([1, 0, 0, 1, 75, 50])).toEqual([
      1, 0, 75,
      0, 1, 50,
      0, 0, 1,
    ]);
  });

  it('keeps the affine coefficients in the right positions (a,c,b,d)', () => {
    expect(pixiMatrixToSkia([2, 3, 4, 5, 6, 7])).toEqual([
      2, 4, 6,
      3, 5, 7,
      0, 0, 1,
    ]);
  });
});

describe('invertMatrix2D', () => {
  it('inverts the identity to itself', () => {
    const inv = invertMatrix2D([1, 0, 0, 1, 0, 0]);
    inv.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1, 0, 0][i], 10));
  });

  it('inverts a pure translation by negating it', () => {
    const inv = invertMatrix2D([1, 0, 0, 1, 75, 50]);
    inv.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1, -75, -50][i], 10));
  });

  it('inverts a scale by reciprocating the diagonal', () => {
    const inv = invertMatrix2D([2, 0, 0, 4, 10, 20]);
    // After inversion the new translation must take the original tx/ty back to (0,0).
    inv.forEach((v, i) =>
      expect(v).toBeCloseTo([0.5, 0, 0, 0.25, -5, -5][i], 10),
    );
  });

  it('returns the identity for a degenerate (non-invertible) matrix', () => {
    const inv = invertMatrix2D([0, 0, 0, 0, 1, 2]);
    expect(inv).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('colorToFloat4', () => {
  it('maps 0xff0000 to red', () => {
    const c = colorToFloat4(0xff0000, 1);
    expect(Array.from(c)).toEqual([1, 0, 0, 1]);
  });

  it('maps 0x00ff00 to green', () => {
    expect(Array.from(colorToFloat4(0x00ff00, 0.5))).toEqual([0, 1, 0, 0.5]);
  });

  it('maps 0x123456 to the right floats', () => {
    const c = colorToFloat4(0x123456, 0.25);
    expect(c[0]).toBeCloseTo(0x12 / 255, 6);
    expect(c[1]).toBeCloseTo(0x34 / 255, 6);
    expect(c[2]).toBeCloseTo(0x56 / 255, 6);
    expect(c[3]).toBeCloseTo(0.25, 6);
  });
});

describe('PixiToSkiaRenderer — group save/concat/restore', () => {
  let mock: MockCanvasKit;
  let canvas: SpyCanvas;
  let renderer: PixiToSkiaRenderer;

  beforeEach(() => {
    mock = makeMockCanvasKit();
    canvas = makeMockCanvas();
    renderer = new PixiToSkiaRenderer(mock.ck);
  });

  it('wraps an empty group node in a balanced save/concat/restore', () => {
    const root = new Container();
    renderer.renderContainer(castCanvas(canvas), root);

    expect(canvas.save).toHaveBeenCalledTimes(1);
    expect(canvas.concat).toHaveBeenCalledTimes(1);
    expect(canvas.restore).toHaveBeenCalledTimes(1);
    // The first concat for an identity-root collapses to identity:
    expect(canvas.concat.mock.calls[0][0]).toEqual([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]);

    const sequence = callOrder(
      { name: 'save', spy: canvas.save },
      { name: 'concat', spy: canvas.concat },
      { name: 'restore', spy: canvas.restore },
    );
    expect(sequence).toEqual(['save', 'concat', 'restore']);
  });

  it('emits save/concat → child save/concat → child restore → restore for nested groups', () => {
    const root = new Container();
    const sub = new Container();
    sub.position.set(75, 50);
    root.addChild(sub);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(canvas.save).toHaveBeenCalledTimes(2);
    expect(canvas.restore).toHaveBeenCalledTimes(2);
    expect(canvas.concat).toHaveBeenCalledTimes(2);
    // Root local = identity, child local = its world relative to identity = translation.
    expect(canvas.concat.mock.calls[1][0]).toEqual([
      1, 0, 75,
      0, 1, 50,
      0, 0, 1,
    ]);

    const sequence = callOrder(
      { name: 'save', spy: canvas.save },
      { name: 'concat', spy: canvas.concat },
      { name: 'restore', spy: canvas.restore },
    );
    expect(sequence).toEqual([
      'save',
      'concat',
      'save',
      'concat',
      'restore',
      'restore',
    ]);
  });

  it('respects ancestor transforms when computing the local matrix for a child', () => {
    const root = new Container();
    root.position.set(10, 20);
    const sub = new Container();
    sub.position.set(75, 50); // world becomes (85, 70)
    root.addChild(sub);

    renderer.renderContainer(castCanvas(canvas), root);

    // First concat is the root's world (since parent above root is identity).
    expect(canvas.concat.mock.calls[0][0]).toEqual([
      1, 0, 10,
      0, 1, 20,
      0, 0, 1,
    ]);
    // Second concat is the sub's LOCAL transform, not its world — local = inv(root) * sub_world.
    expect(canvas.concat.mock.calls[1][0]).toEqual([
      1, 0, 75,
      0, 1, 50,
      0, 0, 1,
    ]);
  });
});

describe('PixiToSkiaRenderer — drawing a filled rect', () => {
  let mock: MockCanvasKit;
  let canvas: SpyCanvas;
  let renderer: PixiToSkiaRenderer;

  beforeEach(() => {
    mock = makeMockCanvasKit();
    canvas = makeMockCanvas();
    renderer = new PixiToSkiaRenderer(mock.ck);
  });

  it('builds a Paint(Fill) and a Path, adds the rect, draws the path, then cleans up', () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(10, 20, 100, 50).endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(mock.paints).toHaveLength(1);
    const paint = mock.paints[0];
    expect(paint.setStyle).toHaveBeenCalledWith(mock.fill);
    expect(paint.setAntiAlias).toHaveBeenCalledWith(true);
    expect(Array.from(paint.setColor.mock.calls[0][0] as Float32Array)).toEqual(
      [1, 0, 0, 1],
    );

    expect(mock.paths).toHaveLength(1);
    const path = mock.paths[0];
    expect(path.addRect).toHaveBeenCalledTimes(1);
    expect(path.addRect.mock.calls[0][0]).toEqual([10, 20, 110, 70]);

    expect(canvas.drawPath).toHaveBeenCalledTimes(1);
    const [drawnPath, drawnPaint] = canvas.drawPath.mock.calls[0];
    expect((drawnPath as SpyPath)._kind).toBe('path');
    // The Path object is drawn directly (no detach step):
    expect(drawnPath).toBe(path);
    expect(drawnPaint).toBe(paint);

    // Resources released:
    expect(paint.delete).toHaveBeenCalledTimes(1);
    expect(path.delete).toHaveBeenCalledTimes(1);
  });

  it('uses LTRBRect for ellipses, centered on (cx,cy) with radii rx,ry', () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0x00ff00, 1).drawEllipse(50, 60, 40, 20).endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    const path = mock.paths[0];
    expect(path.addOval).toHaveBeenCalledTimes(1);
    expect(path.addOval.mock.calls[0][0]).toEqual([10, 40, 90, 80]);
  });

  it('uses addCircle for circle shapes', () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0x0000ff, 1).drawCircle(30, 40, 25).endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    const path = mock.paths[0];
    expect(path.addCircle).toHaveBeenCalledWith(30, 40, 25);
  });
});

describe('PixiToSkiaRenderer — drawing a stroked line', () => {
  let mock: MockCanvasKit;
  let canvas: SpyCanvas;
  let renderer: PixiToSkiaRenderer;

  beforeEach(() => {
    mock = makeMockCanvasKit();
    canvas = makeMockCanvas();
    renderer = new PixiToSkiaRenderer(mock.ck);
  });

  it('produces a Paint(Stroke) with the right width/color and emits moveTo/lineTo on the path', () => {
    const root = new Container();
    const g = new Graphics();
    g.lineStyle(10, 0xffffff, 1).moveTo(0, 0).lineTo(150, 100);
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(mock.paints).toHaveLength(1);
    const paint = mock.paints[0];
    expect(paint.setStyle).toHaveBeenCalledWith(mock.stroke);
    expect(paint.setStrokeWidth).toHaveBeenCalledWith(10);
    expect(Array.from(paint.setColor.mock.calls[0][0] as Float32Array)).toEqual(
      [1, 1, 1, 1],
    );

    const path = mock.paths[0];
    expect(path.moveTo).toHaveBeenCalledWith(0, 0);
    expect(path.lineTo).toHaveBeenCalledWith(150, 100);

    expect(canvas.drawPath).toHaveBeenCalledTimes(1);
    expect(canvas.drawPath.mock.calls[0][1]).toBe(paint);
  });

  it('calls .close() on the path when a closePath command appears', () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0xabcdef, 1)
      .drawPolygon([0, 0, 10, 0, 10, 10, 0, 10])
      .endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);
    const path = mock.paths[0];
    expect(path.close).toHaveBeenCalledTimes(1);
  });
});

describe('PixiToSkiaRenderer — combined fill + stroke on a single shape', () => {
  it('draws the same path twice — once with the fill paint, once with the stroke paint', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck);

    const root = new Container();
    const g = new Graphics();
    g.lineStyle(3, 0x222222, 1)
      .beginFill(0xff8800, 0.5)
      .drawRect(0, 0, 20, 10)
      .endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(mock.paints).toHaveLength(2);
    const fillPaint = mock.paints.find(
      (p) => p.setStyle.mock.calls[0]?.[0] === mock.fill,
    );
    const strokePaint = mock.paints.find(
      (p) => p.setStyle.mock.calls[0]?.[0] === mock.stroke,
    );
    expect(fillPaint).toBeDefined();
    expect(strokePaint).toBeDefined();

    expect(canvas.drawPath).toHaveBeenCalledTimes(2);
    // Order: fill first, then stroke (matches graphics-commands output order).
    expect(canvas.drawPath.mock.calls[0][1]).toBe(fillPaint);
    expect(canvas.drawPath.mock.calls[1][1]).toBe(strokePaint);
    // Same underlying path used for both draws:
    expect(canvas.drawPath.mock.calls[0][0]).toBe(canvas.drawPath.mock.calls[1][0]);
  });
});

describe('PixiToSkiaRenderer — multi-shape Graphics', () => {
  it('uses a fresh Path per shape and draws each in turn', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck);

    const root = new Container();
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(0, 0, 5, 5).endFill();
    g.beginFill(0x00ff00, 1).drawCircle(20, 20, 4).endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(mock.paths.length).toBeGreaterThanOrEqual(2);
    expect(canvas.drawPath).toHaveBeenCalledTimes(2);

    const firstPath = canvas.drawPath.mock.calls[0][0] as SpyPath;
    const secondPath = canvas.drawPath.mock.calls[1][0] as SpyPath;
    // Each shape flushes and allocates a fresh Path — distinct instances.
    expect(firstPath).not.toBe(secondPath);
    expect(firstPath._id).not.toBe(secondPath._id);
  });

  it('does not carry a stroke from a previous entry into a later entry that has no stroke command', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck);

    const root = new Container();
    const g = new Graphics();
    // Entry 1: stroked + filled rect.
    g.lineStyle(2, 0x222222, 1)
      .beginFill(0xff0000, 1)
      .drawRect(0, 0, 5, 5)
      .endFill();
    // Entry 2: fill-only circle (stroke explicitly disabled).
    g.lineStyle(0).beginFill(0x00ff00, 1).drawCircle(20, 20, 4).endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    // Entry 1 draws twice (fill + stroke). Entry 2 must draw only once
    // (fill). Without the `endEntry` reset, the strokePaint from entry 1
    // would carry over and draw a third stroke for the circle.
    expect(canvas.drawPath).toHaveBeenCalledTimes(3);
  });
});

describe('PixiToSkiaRenderer — sprites', () => {
  it('calls drawImageRect(image, frame, dst, paint) using the imageProvider when anchor is (0,0)', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const fakeImage = { __tag: 'image' } as unknown as Image;
    const imageProvider = vi.fn(() => fakeImage);

    const renderer = new PixiToSkiaRenderer(mock.ck, imageProvider);
    const root = new Container();
    const sprite = new Sprite(Texture.WHITE); // 16×16
    sprite.position.set(5, 7);
    root.addChild(sprite);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(imageProvider).toHaveBeenCalledWith(sprite.texture);
    expect(canvas.drawImageRect).toHaveBeenCalledTimes(1);
    const [img, src, dst] = canvas.drawImageRect.mock.calls[0];
    expect(img).toBe(fakeImage);
    // Texture.WHITE has frame (0, 0, 16, 16) → src LTRB is [0, 0, 16, 16].
    expect(src).toEqual([0, 0, 16, 16]);
    // Anchor (0,0) → dst origin is local (0,0); width/height = 16. Use
    // `toBeCloseTo` per coordinate so `-0` (from `-0 * w`) compares
    // equal to `+0`.
    const dstArr = dst as number[];
    expect(dstArr).toHaveLength(4);
    expect(dstArr[0]).toBeCloseTo(0, 10);
    expect(dstArr[1]).toBeCloseTo(0, 10);
    expect(dstArr[2]).toBe(16);
    expect(dstArr[3]).toBe(16);
    expect(canvas.drawImage).not.toHaveBeenCalled();
  });

  it('shifts the destination rect by -anchor*size so anchored sprites match PIXI', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const fakeImage = { __tag: 'image' } as unknown as Image;
    const renderer = new PixiToSkiaRenderer(mock.ck, () => fakeImage);

    const root = new Container();
    const sprite = new Sprite(Texture.WHITE); // 16×16
    sprite.anchor.set(0.5, 0.5);
    root.addChild(sprite);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(canvas.drawImageRect).toHaveBeenCalledTimes(1);
    const dst = canvas.drawImageRect.mock.calls[0][2];
    // -0.5 * 16 = -8; rect extends from (-8,-8) to (8,8).
    expect(dst).toEqual([-8, -8, 8, 8]);
  });

  it('uses the texture frame as the source rect (so atlas frames draw the right region)', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const fakeImage = { __tag: 'atlas' } as unknown as Image;
    const renderer = new PixiToSkiaRenderer(mock.ck, () => fakeImage);

    const root = new Container();
    const sprite = new Sprite(Texture.WHITE);
    // Simulate an atlas sub-frame at (4, 8, 6, 5) inside the WHITE texture.
    sprite.texture.frame.x = 4;
    sprite.texture.frame.y = 8;
    sprite.texture.frame.width = 6;
    sprite.texture.frame.height = 5;
    root.addChild(sprite);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(canvas.drawImageRect).toHaveBeenCalledTimes(1);
    const src = canvas.drawImageRect.mock.calls[0][1];
    expect(src).toEqual([4, 8, 10, 13]);
  });

  it('scales the source rect by baseTexture.resolution so high-DPI textures sample the right pixels', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const fakeImage = { __tag: 'hidpi' } as unknown as Image;
    const renderer = new PixiToSkiaRenderer(mock.ck, () => fakeImage);

    // Build a SkiaSpriteNode directly so we can simulate a resolution=2
    // baseTexture without touching the shared Texture.WHITE singleton.
    const node: SkiaSceneNode = {
      type: 'sprite',
      matrix: [1, 0, 0, 1, 0, 0],
      texture: {
        width: 8,
        height: 10,
        frame: { x: 1, y: 2, width: 4, height: 5 },
        baseTexture: { resolution: 2 },
      } as unknown as import('pixi.js').Texture,
      width: 8,
      height: 10,
      anchor: { x: 0, y: 0 },
      worldAlpha: 1,
      tint: 0xffffff,
      source: {} as unknown as import('pixi.js').DisplayObject,
    };

    renderer.render(castCanvas(canvas), node);

    // src LTRB = (x*r, y*r, (x+w)*r, (y+h)*r) = (2, 4, 10, 14)
    const src = canvas.drawImageRect.mock.calls[0][1];
    expect(src).toEqual([2, 4, 10, 14]);
    // dst stays in logical units — anchor (0,0) → (0,0,w,h). Compare
    // per-coordinate with `toBeCloseTo` so `-0` (from `-0 * w`) matches
    // `+0` (same workaround as the anchor=(0,0) sprite test above).
    const dst = canvas.drawImageRect.mock.calls[0][2] as number[];
    expect(dst).toHaveLength(4);
    expect(dst[0]).toBeCloseTo(0, 10);
    expect(dst[1]).toBeCloseTo(0, 10);
    expect(dst[2]).toBe(8);
    expect(dst[3]).toBe(10);
  });

  it('applies worldAlpha to the sprite paint via setAlphaf', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck, () => ({}) as unknown as Image);

    const root = new Container();
    root.alpha = 0.5;
    const sprite = new Sprite(Texture.WHITE);
    sprite.alpha = 0.5; // worldAlpha = 0.25
    root.addChild(sprite);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(canvas.drawImageRect).toHaveBeenCalledTimes(1);
    const paint = canvas.drawImageRect.mock.calls[0][3] as SpyPaint;
    expect(paint.setAlphaf).toHaveBeenCalledTimes(1);
    expect(paint.setAlphaf.mock.calls[0][0]).toBeCloseTo(0.25, 6);
    expect(paint.setColorFilter).not.toHaveBeenCalled();
    // Paint is always released after the draw.
    expect(paint.delete).toHaveBeenCalledTimes(1);
  });

  it('applies sprite.tint via a Modulate ColorFilter on the paint', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck, () => ({}) as unknown as Image);

    const root = new Container();
    const sprite = new Sprite(Texture.WHITE);
    sprite.tint = 0xff0000;
    root.addChild(sprite);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(canvas.drawImageRect).toHaveBeenCalledTimes(1);
    const paint = canvas.drawImageRect.mock.calls[0][3] as SpyPaint;
    expect(paint.setColorFilter).toHaveBeenCalledTimes(1);
    expect(mock.colorFilters).toHaveLength(1);
    expect(Array.from(mock.colorFilters[0].color)).toEqual([1, 0, 0, 1]);
    expect(mock.colorFilters[0].mode).toBe(mock.modulate);
    expect(paint.setAlphaf).not.toHaveBeenCalled();
    // The color filter is an Embind object; the renderer must release
    // it after the draw to avoid leaking WASM memory on every redraw.
    expect(paint.delete).toHaveBeenCalledTimes(1);
    expect(mock.colorFilters[0].delete).toHaveBeenCalledTimes(1);
  });

  it('does not set alpha or color filter for a default sprite (alpha=1, tint=0xFFFFFF)', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck, () => ({}) as unknown as Image);

    const root = new Container();
    root.addChild(new Sprite(Texture.WHITE));
    renderer.renderContainer(castCanvas(canvas), root);

    const paint = canvas.drawImageRect.mock.calls[0][3] as SpyPaint;
    expect(paint.setAlphaf).not.toHaveBeenCalled();
    expect(paint.setColorFilter).not.toHaveBeenCalled();
  });

  it('silently skips the sprite when no imageProvider is configured (no drawImageRect call)', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck);

    const root = new Container();
    root.addChild(new Sprite(Texture.WHITE));
    renderer.renderContainer(castCanvas(canvas), root);

    expect(canvas.drawImageRect).not.toHaveBeenCalled();
    // The sprite node still gets save/concat/restore though:
    expect(canvas.save).toHaveBeenCalledTimes(2);
    expect(canvas.restore).toHaveBeenCalledTimes(2);
  });

  it('silently skips the sprite when the imageProvider returns null', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck, () => null);

    const root = new Container();
    root.addChild(new Sprite(Texture.WHITE));
    renderer.renderContainer(castCanvas(canvas), root);

    expect(canvas.drawImageRect).not.toHaveBeenCalled();
  });
});

describe('PixiToSkiaRenderer — alpha propagation into colors', () => {
  it('encodes per-command alpha (which may already be multiplied by ancestor alpha) into the paint color', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck);

    const root = new Container();
    root.alpha = 0.5;
    const g = new Graphics();
    g.beginFill(0xff0000, 0.5).drawRect(0, 0, 10, 10).endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    const fillPaint = mock.paints[0];
    const color = fillPaint.setColor.mock.calls[0][0] as Float32Array;
    expect(color[3]).toBeCloseTo(0.25, 6);
  });
});

describe('PixiToSkiaRenderer.render — direct scene node entry point', () => {
  it('accepts a pre-walked SkiaSceneNode (no Pixi container needed)', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck);

    const matrix: Matrix2D = [1, 0, 0, 1, 0, 0];
    const node: SkiaSceneNode = {
      type: 'group',
      matrix,
      children: [],
      // We don't actually use `source` for rendering — cast through unknown.
      source: { } as unknown as import('pixi.js').DisplayObject,
    };

    renderer.render(castCanvas(canvas), node);
    expect(canvas.save).toHaveBeenCalledTimes(1);
    expect(canvas.restore).toHaveBeenCalledTimes(1);
    expect(canvas.concat).toHaveBeenCalledTimes(1);
  });
});

describe('defaultImageProvider', () => {
  function fakeTexture(source: unknown): Texture {
    const baseTexture = {
      resource: { source },
    } as unknown as Texture['baseTexture'];
    return { baseTexture } as unknown as Texture;
  }

  it('calls MakeImageFromCanvasImageSource for an HTMLImageElement and caches the result', () => {
    const img = { __tag: 'img' } as unknown as Image;
    const make = vi.fn(() => img);
    const ck = {
      MakeImageFromCanvasImageSource: make,
    } as unknown as CanvasKit;
    const source = document.createElement('img');
    const texture = fakeTexture(source);

    const provider = defaultImageProvider(ck);
    expect(provider(texture)).toBe(img);
    expect(provider(texture)).toBe(img);
    // The cache key is the baseTexture — a second call must NOT hit the CanvasKit shim.
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith(source);
  });

  it('returns null without calling MakeImageFromCanvasImageSource for an unsupported resource', () => {
    const make = vi.fn(() => ({}) as unknown as Image);
    const ck = {
      MakeImageFromCanvasImageSource: make,
    } as unknown as CanvasKit;
    const texture = fakeTexture(new Uint8Array(4)); // Arbitrary, non-canvas source.

    const provider = defaultImageProvider(ck);
    expect(provider(texture)).toBeNull();
    expect(provider(texture)).toBeNull();
    expect(make).not.toHaveBeenCalled();
  });

  it('retries instead of poisoning the cache when MakeImageFromCanvasImageSource throws', () => {
    const make = vi.fn(() => {
      throw new Error('boom');
    });
    const ck = {
      MakeImageFromCanvasImageSource: make,
    } as unknown as CanvasKit;
    const texture = fakeTexture(document.createElement('img'));

    const provider = defaultImageProvider(ck);
    expect(provider(texture)).toBeNull();
    expect(provider(texture)).toBeNull();
    // Every call re-attempts — a transient failure (image still
    // loading, decode race) must NOT permanently block this texture.
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('does not cache a null result so a later-ready HTMLImageElement can succeed', () => {
    const realImage = { __tag: 'real' } as unknown as Image;
    let unreadyOnce = true;
    const make = vi.fn(() => {
      if (unreadyOnce) {
        unreadyOnce = false;
        return null;
      }
      return realImage;
    });
    const ck = {
      MakeImageFromCanvasImageSource: make,
    } as unknown as CanvasKit;
    const texture = fakeTexture(document.createElement('img'));

    const provider = defaultImageProvider(ck);
    expect(provider(texture)).toBeNull();
    // Once the underlying image is ready (CanvasKit now returns an
    // Image), the next call must produce it instead of serving a
    // cached null.
    expect(provider(texture)).toBe(realImage);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('re-uploads HTMLCanvasElement sources every call so canvas redraws appear', () => {
    const first = { __tag: 'first', delete: vi.fn() } as unknown as Image;
    const second = { __tag: 'second', delete: vi.fn() } as unknown as Image;
    let call = 0;
    const make = vi.fn(() => (call++ === 0 ? first : second));
    const ck = {
      MakeImageFromCanvasImageSource: make,
    } as unknown as CanvasKit;
    const texture = fakeTexture(document.createElement('canvas'));

    const provider = defaultImageProvider(ck);
    expect(provider(texture)).toBe(first);
    // HTMLCanvasElement pixels change between frames — the provider
    // must NOT cache, so a later redraw is reflected on the Skia
    // canvas and in the PDF export.
    expect(provider(texture)).toBe(second);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('re-uploads HTMLVideoElement sources every call so video frames advance', () => {
    const frame1 = { __tag: 'frame1', delete: vi.fn() } as unknown as Image;
    const frame2 = { __tag: 'frame2', delete: vi.fn() } as unknown as Image;
    let call = 0;
    const make = vi.fn(() => (call++ === 0 ? frame1 : frame2));
    const ck = {
      MakeImageFromCanvasImageSource: make,
    } as unknown as CanvasKit;
    const texture = fakeTexture(document.createElement('video'));

    const provider = defaultImageProvider(ck);
    expect(provider(texture)).toBe(frame1);
    expect(provider(texture)).toBe(frame2);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('releases the previous ephemeral Image before producing the next one (no unbounded native leak)', () => {
    const first = { __tag: 'first', delete: vi.fn() } as unknown as Image;
    const second = { __tag: 'second', delete: vi.fn() } as unknown as Image;
    let call = 0;
    const make = vi.fn(() => (call++ === 0 ? first : second));
    const ck = {
      MakeImageFromCanvasImageSource: make,
    } as unknown as CanvasKit;
    const texture = fakeTexture(document.createElement('canvas'));

    const provider = defaultImageProvider(ck);
    expect(provider(texture)).toBe(first);
    // CanvasKit Image holds native (WASM-side) memory that JS GC cannot
    // reclaim, so the previous ephemeral Image must be `.delete()`-ed
    // before we allocate a fresh one — otherwise every redraw of a
    // canvas-/video-backed sprite would leak a new Image.
    expect((first as unknown as { delete: ReturnType<typeof vi.fn> }).delete)
      .not.toHaveBeenCalled();
    expect(provider(texture)).toBe(second);
    expect((first as unknown as { delete: ReturnType<typeof vi.fn> }).delete)
      .toHaveBeenCalledTimes(1);
    expect((second as unknown as { delete: ReturnType<typeof vi.fn> }).delete)
      .not.toHaveBeenCalled();
  });

  it('does not release cached immutable Images on subsequent calls', () => {
    const img = { __tag: 'img', delete: vi.fn() } as unknown as Image;
    const make = vi.fn(() => img);
    const ck = {
      MakeImageFromCanvasImageSource: make,
    } as unknown as CanvasKit;
    const texture = fakeTexture(document.createElement('img'));

    const provider = defaultImageProvider(ck);
    provider(texture);
    provider(texture);
    // Cached immutable Image must outlive a single render — the same
    // instance is returned on every call, so .delete() on it would
    // break the next call's drawImageRect.
    expect((img as unknown as { delete: ReturnType<typeof vi.fn> }).delete)
      .not.toHaveBeenCalled();
  });
});
