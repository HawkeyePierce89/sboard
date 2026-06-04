import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import {
  extractCommands,
  type DrawCommand,
} from '../../src/pixi/graphics-commands';

describe('extractCommands — fills', () => {
  it('emits [fill, rect] for beginFill+drawRect', () => {
    const g = new Graphics();
    g.beginFill(0xff0000, 0.5).drawRect(10, 20, 100, 50).endFill();

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'fill', color: 0xff0000, alpha: 0.5 },
      { type: 'rect', x: 10, y: 20, w: 100, h: 50 },
      { type: 'endEntry' },
    ]);
  });

  it('emits [fill, ellipse] for beginFill+drawEllipse (cx/cy + rx/ry)', () => {
    const g = new Graphics();
    g.beginFill(0x00ff00, 1).drawEllipse(50, 60, 40, 20).endFill();

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'fill', color: 0x00ff00, alpha: 1 },
      { type: 'ellipse', cx: 50, cy: 60, rx: 40, ry: 20 },
      { type: 'endEntry' },
    ]);
  });

  it('emits [fill, circle] for beginFill+drawCircle', () => {
    const g = new Graphics();
    g.beginFill(0x0000ff, 0.8).drawCircle(30, 40, 25).endFill();

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'fill', color: 0x0000ff, alpha: 0.8 },
      { type: 'circle', cx: 30, cy: 40, r: 25 },
      { type: 'endEntry' },
    ]);
  });
});

describe('extractCommands — strokes (moveTo/lineTo via Polygon)', () => {
  it('decomposes an open polyline (lineStyle + moveTo + lineTo) into [stroke, moveTo, lineTo]', () => {
    const g = new Graphics();
    g.lineStyle(4, 0x123456, 0.9).moveTo(10, 20).lineTo(30, 40);

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'stroke', width: 4, color: 0x123456, alpha: 0.9 },
      { type: 'moveTo', x: 10, y: 20 },
      { type: 'lineTo', x: 30, y: 40 },
      { type: 'endEntry' },
    ]);
  });

  it('matches the spec example for g3: lineStyle(10, "#ffffff", 1).moveTo(0,0).lineTo(150,100)', () => {
    const g = new Graphics();
    g.lineStyle(10, '#ffffff', 1).moveTo(0, 0).lineTo(150, 100);

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'stroke', width: 10, color: 0xffffff, alpha: 1 },
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 150, y: 100 },
      { type: 'endEntry' },
    ]);
  });

  it('emits a chain of lineTo for multi-segment open paths', () => {
    const g = new Graphics();
    g.lineStyle(2, 0x000000, 1)
      .moveTo(0, 0)
      .lineTo(10, 0)
      .lineTo(10, 10)
      .lineTo(0, 10);

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'stroke', width: 2, color: 0x000000, alpha: 1 },
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 10, y: 0 },
      { type: 'lineTo', x: 10, y: 10 },
      { type: 'lineTo', x: 0, y: 10 },
      { type: 'endEntry' },
    ]);
  });

  it('appends closePath for drawPolygon (closeStroke=true)', () => {
    const g = new Graphics();
    g.beginFill(0xabcdef, 1)
      .drawPolygon([0, 0, 10, 0, 10, 10, 0, 10])
      .endFill();

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'fill', color: 0xabcdef, alpha: 1 },
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 10, y: 0 },
      { type: 'lineTo', x: 10, y: 10 },
      { type: 'lineTo', x: 0, y: 10 },
      { type: 'closePath' },
      { type: 'endEntry' },
    ]);
  });
});

describe('extractCommands — combined fill + stroke', () => {
  it('emits [fill, stroke, shape] when both styles are active on a single shape', () => {
    const g = new Graphics();
    g.lineStyle(3, 0x222222, 1)
      .beginFill(0xff8800, 0.5)
      .drawRect(0, 0, 20, 10)
      .endFill();

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'fill', color: 0xff8800, alpha: 0.5 },
      { type: 'stroke', width: 3, color: 0x222222, alpha: 1 },
      { type: 'rect', x: 0, y: 0, w: 20, h: 10 },
      { type: 'endEntry' },
    ]);
  });
});

describe('extractCommands — multi-shape Graphics', () => {
  it('concatenates commands for two shapes in one Graphics object', () => {
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(0, 0, 5, 5).endFill();
    g.beginFill(0x00ff00, 1).drawCircle(20, 20, 4).endFill();

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'fill', color: 0xff0000, alpha: 1 },
      { type: 'rect', x: 0, y: 0, w: 5, h: 5 },
      { type: 'endEntry' },
      { type: 'fill', color: 0x00ff00, alpha: 1 },
      { type: 'circle', cx: 20, cy: 20, r: 4 },
      { type: 'endEntry' },
    ]);
  });

  it('returns an empty array for a Graphics with no drawing calls', () => {
    expect(extractCommands(new Graphics())).toEqual([]);
  });

  it('skips invisible fill (alpha = 0 resets fillStyle.visible) and emits stroke only', () => {
    const g = new Graphics();
    g.beginFill(0xff0000, 0).lineStyle(1, 0x000000, 1).drawRect(0, 0, 10, 10);
    g.finishPoly();

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'stroke', width: 1, color: 0x000000, alpha: 1 },
      { type: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { type: 'endEntry' },
    ]);
  });
});

describe('extractCommands — pending polygon commit', () => {
  it('commits a pending moveTo/lineTo polygon without requiring an explicit finishPoly call', () => {
    const g = new Graphics();
    g.lineStyle(1, 0x000000, 1).moveTo(0, 0).lineTo(5, 5);

    const cmds = extractCommands(g);
    expect(cmds).toEqual<DrawCommand[]>([
      { type: 'stroke', width: 1, color: 0x000000, alpha: 1 },
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 5, y: 5 },
      { type: 'endEntry' },
    ]);
  });
});
