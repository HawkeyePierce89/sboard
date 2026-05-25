import { describe, expect, it } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { hitTest } from '../../src/skia/hit-test';
import { walkContainer } from '../../src/pixi/scene-walker';
import type {
  SkiaGraphicsNode,
  SkiaGroupNode,
  SkiaSceneNode,
} from '../../src/pixi/scene-walker';

function buildGraphicsNode(
  source: Graphics,
  matrix: SkiaGraphicsNode['matrix'] = [1, 0, 0, 1, 0, 0],
  commands: SkiaGraphicsNode['commands'] = [],
): SkiaGraphicsNode {
  return {
    type: 'graphics',
    matrix,
    commands,
    source,
  };
}

function buildGroupNode(
  source: Container,
  matrix: SkiaGroupNode['matrix'] = [1, 0, 0, 1, 0, 0],
  children: SkiaSceneNode[] = [],
): SkiaGroupNode {
  return {
    type: 'group',
    matrix,
    children,
    source,
  };
}

describe('hitTest — rectangles (filled)', () => {
  it('returns the source when the point lies inside a filled rect', () => {
    const g = new Graphics();
    const node = buildGroupNode(new Container(), [1, 0, 0, 1, 0, 0], [
      buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
        { type: 'fill', color: 0xff0000, alpha: 1 },
        { type: 'rect', x: 10, y: 20, w: 100, h: 50 },
      ]),
    ]);

    expect(hitTest(node, 60, 45)).toBe(g);
    expect(hitTest(node, 10, 20)).toBe(g);
    expect(hitTest(node, 110, 70)).toBe(g);
  });

  it('returns null when the point is just outside a filled rect', () => {
    const g = new Graphics();
    const node = buildGroupNode(new Container(), [1, 0, 0, 1, 0, 0], [
      buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
        { type: 'fill', color: 0xff0000, alpha: 1 },
        { type: 'rect', x: 10, y: 20, w: 100, h: 50 },
      ]),
    ]);

    expect(hitTest(node, 9.5, 45)).toBeNull();
    expect(hitTest(node, 60, 70.5)).toBeNull();
    expect(hitTest(node, 200, 200)).toBeNull();
  });

  it('honours the world matrix on the graphics node (translated rect)', () => {
    const g = new Graphics();
    const node = buildGroupNode(new Container(), [1, 0, 0, 1, 0, 0], [
      // Graphics is at world translation (100, 200); local rect at (0,0,50,50)
      buildGraphicsNode(g, [1, 0, 0, 1, 100, 200], [
        { type: 'fill', color: 0xff0000, alpha: 1 },
        { type: 'rect', x: 0, y: 0, w: 50, h: 50 },
      ]),
    ]);

    expect(hitTest(node, 120, 220)).toBe(g);
    expect(hitTest(node, 60, 60)).toBeNull();
  });

  it('returns the source for a hit inside a rotated rect (45°)', () => {
    const angle = Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const g = new Graphics();
    // Local rect [0..100, 0..100] centred at local (50,50). Rotate around
    // origin → world matrix [cos, sin, -sin, cos, 0, 0].
    const node = buildGroupNode(new Container(), [1, 0, 0, 1, 0, 0], [
      buildGraphicsNode(g, [cos, sin, -sin, cos, 0, 0], [
        { type: 'fill', color: 0x000000, alpha: 1 },
        { type: 'rect', x: 0, y: 0, w: 100, h: 100 },
      ]),
    ]);

    // The local centre (50, 50) lands at world (0, sqrt(50^2+50^2)) ≈ (0, 70.71).
    expect(hitTest(node, 0, 70.71)).toBe(g);
    // A clearly outside point (well to the left of the rotated diamond).
    expect(hitTest(node, -120, 0)).toBeNull();
    // Tip on the right side of the rotated rect: local (100, 0) → world (cos·100, sin·100) = (70.71, 70.71)
    expect(hitTest(node, 70.71, 70.71)).toBe(g);
  });

  it('skips invisible (alpha=0) fill — no hit even inside the geometry', () => {
    const g = new Graphics();
    const node = buildGroupNode(new Container(), [1, 0, 0, 1, 0, 0], [
      buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
        { type: 'fill', color: 0xff0000, alpha: 0 },
        { type: 'rect', x: 0, y: 0, w: 100, h: 100 },
      ]),
    ]);

    expect(hitTest(node, 50, 50)).toBeNull();
  });
});

describe('hitTest — rectangles (stroked)', () => {
  it('hits along the edge of a stroked-only rect (within half stroke width)', () => {
    const g = new Graphics();
    const node = buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
      { type: 'stroke', width: 10, color: 0x000000, alpha: 1 },
      { type: 'rect', x: 0, y: 0, w: 100, h: 100 },
    ]);

    // Right on the top edge.
    expect(hitTest(node, 50, 0)).toBe(g);
    // Just outside (more than 5 px from the edge) → miss.
    expect(hitTest(node, 50, -6)).toBeNull();
    // Centre of a stroke-only rect → miss (no fill, well inside).
    expect(hitTest(node, 50, 50)).toBeNull();
  });
});

describe('hitTest — ellipses and circles', () => {
  it('hits inside a filled ellipse', () => {
    const g = new Graphics();
    const node = buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
      { type: 'fill', color: 0xff0000, alpha: 1 },
      { type: 'ellipse', cx: 100, cy: 100, rx: 60, ry: 40 },
    ]);

    expect(hitTest(node, 100, 100)).toBe(g);
    expect(hitTest(node, 159, 100)).toBe(g);
    // Inside the bounding box but outside the ellipse (corner of bbox).
    expect(hitTest(node, 159, 139)).toBeNull();
  });

  it('hits inside a filled circle', () => {
    const g = new Graphics();
    const node = buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
      { type: 'fill', color: 0x00ff00, alpha: 1 },
      { type: 'circle', cx: 50, cy: 50, r: 30 },
    ]);

    expect(hitTest(node, 60, 50)).toBe(g);
    expect(hitTest(node, 50, 81)).toBeNull();
  });
});

describe('hitTest — polylines (stroked)', () => {
  it('hits within half stroke width of a line segment', () => {
    const g = new Graphics();
    // The spec g3: lineStyle(10, white).moveTo(0,0).lineTo(150,100)
    const node = buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
      { type: 'stroke', width: 10, color: 0xffffff, alpha: 1 },
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 150, y: 100 },
    ]);

    // Midpoint of the segment.
    expect(hitTest(node, 75, 50)).toBe(g);
    // Endpoint.
    expect(hitTest(node, 0, 0)).toBe(g);
    // Far off the line.
    expect(hitTest(node, 75, 0)).toBeNull();
  });

  it('returns null for a polyline with no stroke style', () => {
    const g = new Graphics();
    const node = buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 100, y: 0 },
    ]);

    expect(hitTest(node, 50, 0)).toBeNull();
  });

  it('hits inside a filled, closed polygon (point-in-polygon)', () => {
    const g = new Graphics();
    const node = buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
      { type: 'fill', color: 0xff00ff, alpha: 1 },
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 100, y: 0 },
      { type: 'lineTo', x: 100, y: 100 },
      { type: 'lineTo', x: 0, y: 100 },
      { type: 'closePath' },
    ]);

    expect(hitTest(node, 50, 50)).toBe(g);
    expect(hitTest(node, 150, 50)).toBeNull();
  });
});

describe('hitTest — z-ordering (top child wins)', () => {
  it('returns the visually top-most child when two graphics overlap', () => {
    const bottom = new Graphics();
    const top = new Graphics();
    const node = buildGroupNode(new Container(), [1, 0, 0, 1, 0, 0], [
      buildGraphicsNode(bottom, [1, 0, 0, 1, 0, 0], [
        { type: 'fill', color: 0xff0000, alpha: 1 },
        { type: 'rect', x: 0, y: 0, w: 100, h: 100 },
      ]),
      buildGraphicsNode(top, [1, 0, 0, 1, 0, 0], [
        { type: 'fill', color: 0x00ff00, alpha: 1 },
        { type: 'rect', x: 50, y: 50, w: 100, h: 100 },
      ]),
    ]);

    // Overlap region: top wins.
    expect(hitTest(node, 60, 60)).toBe(top);
    // Bottom-only area.
    expect(hitTest(node, 10, 10)).toBe(bottom);
    // Top-only area.
    expect(hitTest(node, 140, 140)).toBe(top);
  });
});

describe('hitTest — nested containers (world-matrix propagation)', () => {
  it('hits a graphics inside a translated sub-container (spec g3 example)', () => {
    const root = new Container();
    const sub = new Container();
    sub.position.set(75, 50);
    const g3 = new Graphics();
    g3.lineStyle(10, 0xffffff, 1).moveTo(0, 0).lineTo(150, 100);
    sub.addChild(g3);
    root.addChild(sub);

    const tree = walkContainer(root);

    // World midpoint of g3's segment is (75 + 75, 50 + 50) = (150, 100).
    expect(hitTest(tree, 150, 100)).toBe(g3);
    // Far away — no hit.
    expect(hitTest(tree, 10, 10)).toBeNull();
  });

  it('returns null when the scene tree is an empty group', () => {
    const root = new Container();
    const tree = walkContainer(root);
    expect(hitTest(tree, 0, 0)).toBeNull();
  });
});

describe('hitTest — sprites', () => {
  it('hits inside the sprite bounding rect', () => {
    const root = new Container();
    const sprite = new Sprite(Texture.WHITE);
    sprite.width = 80;
    sprite.height = 40;
    sprite.position.set(10, 20);
    root.addChild(sprite);
    const tree = walkContainer(root);

    expect(hitTest(tree, 30, 30)).toBe(sprite);
    expect(hitTest(tree, 9, 30)).toBeNull();
    expect(hitTest(tree, 30, 65)).toBeNull();
  });

  it('respects sprite anchor when hit-testing (anchor=0.5 → bounds shift by -w/2,-h/2)', () => {
    const root = new Container();
    const sprite = new Sprite(Texture.WHITE); // 16×16
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(100, 100);
    root.addChild(sprite);
    const tree = walkContainer(root);

    // Texture size 16, anchor centred → bounds in world space:
    //   [100 - 8 .. 100 + 8] x [100 - 8 .. 100 + 8]
    expect(hitTest(tree, 100, 100)).toBe(sprite);
    expect(hitTest(tree, 93, 100)).toBe(sprite);
    // Just outside the centred bbox on the right:
    expect(hitTest(tree, 109, 100)).toBeNull();
    // Old (no-anchor) top-left rect would have hit (105, 105); now it misses.
    expect(hitTest(tree, 115, 115)).toBeNull();
  });
});

describe('hitTest — invisible subtree', () => {
  it('does not return invisible descendants', () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(0, 0, 100, 100).endFill();
    g.visible = false;
    root.addChild(g);
    const tree = walkContainer(root);

    expect(hitTest(tree, 50, 50)).toBeNull();
  });
});

describe('hitTest — endEntry boundary', () => {
  it('does not leak fill paint between graphicsData entries', () => {
    // Entry 1: filled rect at (0,0,100,100).
    // Entry 2: same shape but no fill/stroke command (drawn invisible).
    // Without an endEntry reset the second entry would inherit entry 1's
    // fillActive and still report a hit on it.
    const g = new Graphics();
    const node = buildGroupNode(new Container(), [1, 0, 0, 1, 0, 0], [
      buildGraphicsNode(g, [1, 0, 0, 1, 0, 0], [
        { type: 'fill', color: 0xff0000, alpha: 1 },
        { type: 'rect', x: 0, y: 0, w: 100, h: 100 },
        { type: 'endEntry' },
        // Entry 2: only geometry, no style. Should be ignored by hit-test.
        { type: 'rect', x: 200, y: 200, w: 100, h: 100 },
        { type: 'endEntry' },
      ]),
    ]);

    // Entry 1 still hits.
    expect(hitTest(node, 50, 50)).toBe(g);
    // Entry 2 must NOT hit — it has no active paint.
    expect(hitTest(node, 250, 250)).toBeNull();
  });
});
