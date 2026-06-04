import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { addRandomShape } from '../../src/ui/random-shape';
import { extractCommands } from '../../src/pixi/graphics-commands';

// `Math.floor(r * 4)` selects the shape type from a 4-entry table:
//   r=0.1 → 0 → 'rect'
//   r=0.3 → 1 → 'ellipse'
//   r=0.6 → 2 → 'line'      (NOT 0.5 — that yields dx=dy=0 and PIXI
//                            dedupes the degenerate `lineTo(0,0)` so no
//                            polygon is ever committed, which would
//                            drop the stroke style entirely.)
//   r=0.9 → 3 → 'polygon'
const RECT_SEED = () => 0.1;
const ELLIPSE_SEED = () => 0.3;
const LINE_SEED = () => 0.6;
const POLYGON_SEED = () => 0.9;

describe('addRandomShape', () => {
  it('mutates the container (children.length grows by 1)', () => {
    const container = new Container();
    expect(container.children).toHaveLength(0);

    addRandomShape(container, { w: 500, h: 400 }, { random: RECT_SEED });
    expect(container.children).toHaveLength(1);

    addRandomShape(container, { w: 500, h: 400 }, { random: LINE_SEED });
    expect(container.children).toHaveLength(2);
  });

  it('returns a PIXI.Graphics with non-empty commands', () => {
    const container = new Container();
    const result = addRandomShape(
      container,
      { w: 500, h: 400 },
      { random: RECT_SEED },
    );
    expect(result).toBeInstanceOf(Graphics);
    expect(container.children[0]).toBe(result);
    expect(extractCommands(result).length).toBeGreaterThan(0);
  });

  it('produces a filled rect when the type-selector lands on 0', () => {
    const g = addRandomShape(new Container(), { w: 500, h: 400 }, {
      random: RECT_SEED,
    });
    const cmds = extractCommands(g);
    expect(cmds.some((c) => c.type === 'fill')).toBe(true);
    expect(cmds.some((c) => c.type === 'rect')).toBe(true);
    expect(g.name).toBe('random:rect');
  });

  it('produces a filled ellipse when the type-selector lands on 1', () => {
    const g = addRandomShape(new Container(), { w: 500, h: 400 }, {
      random: ELLIPSE_SEED,
    });
    const cmds = extractCommands(g);
    expect(cmds.some((c) => c.type === 'fill')).toBe(true);
    expect(cmds.some((c) => c.type === 'ellipse')).toBe(true);
    expect(g.name).toBe('random:ellipse');
  });

  it('produces a stroked line when the type-selector lands on 2', () => {
    const g = addRandomShape(new Container(), { w: 500, h: 400 }, {
      random: LINE_SEED,
    });
    const cmds = extractCommands(g);
    expect(cmds.some((c) => c.type === 'stroke')).toBe(true);
    expect(cmds.some((c) => c.type === 'moveTo')).toBe(true);
    expect(cmds.some((c) => c.type === 'lineTo')).toBe(true);
    expect(g.name).toBe('random:line');
  });

  it('produces a closed polygon (stroke + fill + ≥3 line segments) on type 3', () => {
    const g = addRandomShape(new Container(), { w: 500, h: 400 }, {
      random: POLYGON_SEED,
    });
    const cmds = extractCommands(g);
    expect(cmds.some((c) => c.type === 'fill')).toBe(true);
    expect(cmds.some((c) => c.type === 'stroke')).toBe(true);
    expect(cmds.some((c) => c.type === 'moveTo')).toBe(true);
    // 3 vertices → at least 2 lineTo segments (plus a closePath emitted
    // by Polygon.closeStroke=true through extractCommands).
    expect(cmds.filter((c) => c.type === 'lineTo').length).toBeGreaterThanOrEqual(2);
    expect(cmds.some((c) => c.type === 'closePath')).toBe(true);
    expect(g.name).toBe('random:polygon');
  });

  it('uses the supplied bounds to scale the random position', () => {
    // With a constant seed of 1, position.x = 1 * bounds.w, position.y =
    // 1 * bounds.h. Using `() => 1` exactly would push the type selector
    // out of range (Math.floor(1*4)=4); use `0.999` to stay on
    // 'polygon' while still pinning position to almost-bounds.
    const g = addRandomShape(new Container(), { w: 800, h: 600 }, {
      random: () => 0.999,
    });
    expect(g.position.x).toBeGreaterThan(700);
    expect(g.position.x).toBeLessThanOrEqual(800);
    expect(g.position.y).toBeGreaterThan(500);
    expect(g.position.y).toBeLessThanOrEqual(600);
  });

  it('applies a uniform scale in [0.5, 1.5] derived from the random source', () => {
    // The scale call consumes one random value; with random=0, scale=0.5;
    // with random=0.999..., scale ≈ 1.499.
    const low = addRandomShape(new Container(), { w: 100, h: 100 }, {
      random: () => 0,
    });
    expect(low.scale.x).toBeCloseTo(0.5, 5);
    expect(low.scale.y).toBeCloseTo(0.5, 5);
    expect(low.scale.x).toBe(low.scale.y);

    const high = addRandomShape(new Container(), { w: 100, h: 100 }, {
      random: () => 0.999,
    });
    expect(high.scale.x).toBeGreaterThan(1.49);
    expect(high.scale.x).toBe(high.scale.y);
  });

  it('applies a rotation in [0, 2π) derived from the random source', () => {
    const g = addRandomShape(new Container(), { w: 100, h: 100 }, {
      random: () => 0,
    });
    expect(g.rotation).toBe(0);

    const g2 = addRandomShape(new Container(), { w: 100, h: 100 }, {
      random: () => 0.5,
    });
    expect(g2.rotation).toBeCloseTo(Math.PI, 5);
  });

  it('honours an explicit `name` option (overrides the random:<type> default)', () => {
    const g = addRandomShape(new Container(), { w: 100, h: 100 }, {
      random: RECT_SEED,
      name: 'custom',
    });
    expect(g.name).toBe('custom');
  });

  it('is deterministic when Math.random is mocked', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => 0.42);
    try {
      const a = addRandomShape(new Container(), { w: 500, h: 400 });
      const b = addRandomShape(new Container(), { w: 500, h: 400 });
      expect(extractCommands(a)).toEqual(extractCommands(b));
      expect(a.position.x).toBe(b.position.x);
      expect(a.position.y).toBe(b.position.y);
      expect(a.rotation).toBe(b.rotation);
      expect(a.scale.x).toBe(b.scale.x);
      expect(a.name).toBe(b.name);
    } finally {
      spy.mockRestore();
    }
  });

  it('cycles through every shape type as the type-selector advances', () => {
    // Single sweep across the four constants — verifies the shape table
    // is exactly { rect, ellipse, line, polygon } in that order and that
    // the implementation does not hide a 5th branch.
    const seeds: Array<[() => number, string]> = [
      [RECT_SEED, 'random:rect'],
      [ELLIPSE_SEED, 'random:ellipse'],
      [LINE_SEED, 'random:line'],
      [POLYGON_SEED, 'random:polygon'],
    ];
    for (const [random, expectedName] of seeds) {
      const g = addRandomShape(new Container(), { w: 500, h: 400 }, { random });
      expect(g.name).toBe(expectedName);
    }
  });

  it('does not throw when bounds are zero-sized (degenerate but valid)', () => {
    expect(() =>
      addRandomShape(new Container(), { w: 0, h: 0 }, { random: RECT_SEED }),
    ).not.toThrow();
  });
});
