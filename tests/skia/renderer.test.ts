import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { CanvasKit, Image } from 'canvaskit-wasm';
import {
  PixiToSkiaRenderer,
  colorToFloat4,
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
  delete: ReturnType<typeof vi.fn>;
  _kind: 'paint';
  _id: number;
}

interface SpyPathBuilder {
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  addRect: ReturnType<typeof vi.fn>;
  addOval: ReturnType<typeof vi.fn>;
  addCircle: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  _kind: 'pathBuilder';
  _id: number;
}

interface SpyPath {
  delete: ReturnType<typeof vi.fn>;
  _kind: 'path';
  _builderId: number;
  _id: number;
}

interface SpyCanvas {
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  concat: ReturnType<typeof vi.fn>;
  drawPath: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

interface MockCanvasKit {
  ck: CanvasKit;
  paints: SpyPaint[];
  builders: SpyPathBuilder[];
  paths: SpyPath[];
  fill: 'FILL';
  stroke: 'STROKE';
}

function makeMockCanvasKit(): MockCanvasKit {
  const paints: SpyPaint[] = [];
  const builders: SpyPathBuilder[] = [];
  const paths: SpyPath[] = [];

  const PaintCtor = vi.fn(function (): SpyPaint {
    const paint: SpyPaint = {
      setStyle: vi.fn(),
      setColor: vi.fn(),
      setStrokeWidth: vi.fn(),
      setAntiAlias: vi.fn(),
      delete: vi.fn(),
      _kind: 'paint',
      _id: paints.length,
    };
    paints.push(paint);
    return paint;
  });

  const PathBuilderCtor = vi.fn(function (): SpyPathBuilder {
    const id = builders.length;
    const detach = vi.fn(() => {
      const path: SpyPath = {
        delete: vi.fn(),
        _kind: 'path',
        _builderId: id,
        _id: paths.length,
      };
      paths.push(path);
      return path;
    });
    const builder: SpyPathBuilder = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      addRect: vi.fn(),
      addOval: vi.fn(),
      addCircle: vi.fn(),
      close: vi.fn(),
      detach,
      delete: vi.fn(),
      _kind: 'pathBuilder',
      _id: id,
    };
    // chainable
    builder.moveTo.mockReturnValue(builder);
    builder.lineTo.mockReturnValue(builder);
    builder.addRect.mockReturnValue(builder);
    builder.addOval.mockReturnValue(builder);
    builder.addCircle.mockReturnValue(builder);
    builder.close.mockReturnValue(builder);
    builders.push(builder);
    return builder;
  });

  const ck = {
    Paint: PaintCtor,
    PathBuilder: PathBuilderCtor,
    PaintStyle: { Fill: 'FILL', Stroke: 'STROKE' },
    XYWHRect: (x: number, y: number, w: number, h: number) =>
      [x, y, x + w, y + h] as unknown,
    LTRBRect: (l: number, t: number, r: number, b: number) =>
      [l, t, r, b] as unknown,
  } as unknown as CanvasKit;

  return { ck, paints, builders, paths, fill: 'FILL', stroke: 'STROKE' };
}

function makeMockCanvas(): SpyCanvas {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    concat: vi.fn(),
    drawPath: vi.fn(),
    drawImage: vi.fn(),
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

  it('builds a Paint(Fill) and a PathBuilder, adds the rect, draws the path, then cleans up', () => {
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

    expect(mock.builders).toHaveLength(1);
    const builder = mock.builders[0];
    expect(builder.addRect).toHaveBeenCalledTimes(1);
    expect(builder.addRect.mock.calls[0][0]).toEqual([10, 20, 110, 70]);

    expect(canvas.drawPath).toHaveBeenCalledTimes(1);
    const [drawnPath, drawnPaint] = canvas.drawPath.mock.calls[0];
    expect((drawnPath as SpyPath)._kind).toBe('path');
    expect(drawnPaint).toBe(paint);

    // Resources released:
    expect(paint.delete).toHaveBeenCalledTimes(1);
    expect((drawnPath as SpyPath).delete).toHaveBeenCalledTimes(1);
    expect(builder.delete).toHaveBeenCalled();
  });

  it('uses LTRBRect for ellipses, centered on (cx,cy) with radii rx,ry', () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0x00ff00, 1).drawEllipse(50, 60, 40, 20).endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    const builder = mock.builders[0];
    expect(builder.addOval).toHaveBeenCalledTimes(1);
    expect(builder.addOval.mock.calls[0][0]).toEqual([10, 40, 90, 80]);
  });

  it('uses addCircle for circle shapes', () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0x0000ff, 1).drawCircle(30, 40, 25).endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    const builder = mock.builders[0];
    expect(builder.addCircle).toHaveBeenCalledWith(30, 40, 25);
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

  it('produces a Paint(Stroke) with the right width/color and emits moveTo/lineTo on the builder', () => {
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

    const builder = mock.builders[0];
    expect(builder.moveTo).toHaveBeenCalledWith(0, 0);
    expect(builder.lineTo).toHaveBeenCalledWith(150, 100);

    expect(canvas.drawPath).toHaveBeenCalledTimes(1);
    expect(canvas.drawPath.mock.calls[0][1]).toBe(paint);
  });

  it('calls .close() on the builder when a closePath command appears', () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0xabcdef, 1)
      .drawPolygon([0, 0, 10, 0, 10, 10, 0, 10])
      .endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);
    const builder = mock.builders[0];
    expect(builder.close).toHaveBeenCalledTimes(1);
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
  it('uses a fresh PathBuilder per shape and draws each in turn', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck);

    const root = new Container();
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(0, 0, 5, 5).endFill();
    g.beginFill(0x00ff00, 1).drawCircle(20, 20, 4).endFill();
    root.addChild(g);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(mock.builders.length).toBeGreaterThanOrEqual(2);
    expect(canvas.drawPath).toHaveBeenCalledTimes(2);

    const firstPath = canvas.drawPath.mock.calls[0][0] as SpyPath;
    const secondPath = canvas.drawPath.mock.calls[1][0] as SpyPath;
    expect(firstPath._builderId).not.toBe(secondPath._builderId);
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
  it('calls drawImage(image, 0, 0) using the imageProvider', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const fakeImage = { __tag: 'image' } as unknown as Image;
    const imageProvider = vi.fn(() => fakeImage);

    const renderer = new PixiToSkiaRenderer(mock.ck, imageProvider);
    const root = new Container();
    const sprite = new Sprite(Texture.WHITE);
    sprite.position.set(5, 7);
    root.addChild(sprite);

    renderer.renderContainer(castCanvas(canvas), root);

    expect(imageProvider).toHaveBeenCalledWith(sprite.texture);
    expect(canvas.drawImage).toHaveBeenCalledTimes(1);
    expect(canvas.drawImage.mock.calls[0][0]).toBe(fakeImage);
    expect(canvas.drawImage.mock.calls[0][1]).toBe(0);
    expect(canvas.drawImage.mock.calls[0][2]).toBe(0);
  });

  it('silently skips the sprite when no imageProvider is configured (no drawImage call)', () => {
    const mock = makeMockCanvasKit();
    const canvas = makeMockCanvas();
    const renderer = new PixiToSkiaRenderer(mock.ck);

    const root = new Container();
    root.addChild(new Sprite(Texture.WHITE));
    renderer.renderContainer(castCanvas(canvas), root);

    expect(canvas.drawImage).not.toHaveBeenCalled();
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

    expect(canvas.drawImage).not.toHaveBeenCalled();
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
