import { describe, expect, it } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { walkContainer } from '../../src/pixi/scene-walker';
import type {
  SkiaSceneNode,
  SkiaGroupNode,
  SkiaGraphicsNode,
  SkiaSpriteNode,
} from '../../src/pixi/scene-walker';
import type { Matrix2D } from '../../src/pixi/transform';

function expectMatrixApprox(actual: Matrix2D, expected: Matrix2D): void {
  for (let i = 0; i < 6; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 6);
  }
}

function asGroup(node: SkiaSceneNode): SkiaGroupNode {
  expect(node.type).toBe('group');
  return node as SkiaGroupNode;
}

function asGraphics(node: SkiaSceneNode): SkiaGraphicsNode {
  expect(node.type).toBe('graphics');
  return node as SkiaGraphicsNode;
}

function asSprite(node: SkiaSceneNode): SkiaSpriteNode {
  expect(node.type).toBe('sprite');
  return node as SkiaSpriteNode;
}

describe('walkContainer — basic node typing', () => {
  it('returns a group node for an empty Container', () => {
    const root = new Container();
    const node = walkContainer(root);

    const group = asGroup(node);
    expect(group.source).toBe(root);
    expect(group.children).toEqual([]);
    expectMatrixApprox(group.matrix, [1, 0, 0, 1, 0, 0]);
  });

  it('wraps a single Graphics child as a graphics node inside the root group (flat tree)', () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(0, 0, 10, 10).endFill();
    root.addChild(g);

    const group = asGroup(walkContainer(root));
    expect(group.children).toHaveLength(1);

    const gfx = asGraphics(group.children[0]);
    expect(gfx.source).toBe(g);
    expect(gfx.commands).toEqual([
      { type: 'fill', color: 0xff0000, alpha: 1 },
      { type: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { type: 'endEntry' },
    ]);
    expectMatrixApprox(gfx.matrix, [1, 0, 0, 1, 0, 0]);
  });

  it('emits a sprite node for PIXI.Sprite children with texture/width/height/source', () => {
    const root = new Container();
    const sprite = new Sprite(Texture.WHITE);
    // Texture.WHITE is 16×16; width/height setters bake the ratio into scale.
    sprite.width = 32;
    sprite.height = 24;
    sprite.position.set(5, 7);
    root.addChild(sprite);

    const group = asGroup(walkContainer(root));
    expect(group.children).toHaveLength(1);

    const sp = asSprite(group.children[0]);
    expect(sp.source).toBe(sprite);
    expect(sp.texture).toBe(sprite.texture);
    expect(sp.width).toBe(32);
    expect(sp.height).toBe(24);
    expectMatrixApprox(sp.matrix, [2, 0, 0, 1.5, 5, 7]);
  });
});

describe('walkContainer — nested containers (spec example)', () => {
  it('builds a group→group→graphics tree for the subContainer case', () => {
    // Mimics the spec: a sub-container at (75, 50) with g3 inside.
    const root = new Container();
    const sub = new Container();
    sub.position.set(75, 50);
    const g3 = new Graphics();
    g3.lineStyle(10, 0xffffff, 1).moveTo(0, 0).lineTo(150, 100);
    sub.addChild(g3);
    root.addChild(sub);

    const top = asGroup(walkContainer(root));
    expect(top.children).toHaveLength(1);

    const subNode = asGroup(top.children[0]);
    expect(subNode.source).toBe(sub);
    expectMatrixApprox(subNode.matrix, [1, 0, 0, 1, 75, 50]);
    expect(subNode.children).toHaveLength(1);

    const gfx = asGraphics(subNode.children[0]);
    expect(gfx.source).toBe(g3);
    expect(gfx.commands).toEqual([
      { type: 'stroke', width: 10, color: 0xffffff, alpha: 1 },
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 150, y: 100 },
      { type: 'endEntry' },
    ]);
  });

  it('inherits world matrix down the chain — child translation is folded into parent translation', () => {
    const root = new Container();
    root.position.set(100, 50);
    const child = new Graphics();
    child.position.set(10, 20);
    child.beginFill(0x000000, 1).drawRect(0, 0, 1, 1).endFill();
    root.addChild(child);

    const top = asGroup(walkContainer(root));
    expectMatrixApprox(top.matrix, [1, 0, 0, 1, 100, 50]);

    const gfx = asGraphics(top.children[0]);
    expectMatrixApprox(gfx.matrix, [1, 0, 0, 1, 110, 70]);
  });

  it('preserves child order in the resulting group', () => {
    const root = new Container();
    const a = new Graphics();
    a.beginFill(0x111111, 1).drawRect(0, 0, 1, 1).endFill();
    const b = new Graphics();
    b.beginFill(0x222222, 1).drawRect(0, 0, 1, 1).endFill();
    const c = new Graphics();
    c.beginFill(0x333333, 1).drawRect(0, 0, 1, 1).endFill();
    root.addChild(a, b, c);

    const top = asGroup(walkContainer(root));
    expect(top.children.map((n) => (n as SkiaGraphicsNode).source)).toEqual([
      a,
      b,
      c,
    ]);
  });
});

describe('walkContainer — visibility', () => {
  it('skips invisible children entirely', () => {
    const root = new Container();
    const visible = new Graphics();
    visible.beginFill(0x111111, 1).drawRect(0, 0, 1, 1).endFill();
    const hidden = new Graphics();
    hidden.beginFill(0x222222, 1).drawRect(0, 0, 1, 1).endFill();
    hidden.visible = false;

    root.addChild(visible, hidden);

    const top = asGroup(walkContainer(root));
    expect(top.children).toHaveLength(1);
    expect(asGraphics(top.children[0]).source).toBe(visible);
  });

  it('drops the entire subtree under an invisible container', () => {
    const root = new Container();
    const sub = new Container();
    sub.visible = false;
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(0, 0, 5, 5).endFill();
    sub.addChild(g);
    root.addChild(sub);

    const top = asGroup(walkContainer(root));
    expect(top.children).toEqual([]);
  });

  it('returns a degenerate group node when the root itself is invisible', () => {
    const root = new Container();
    root.visible = false;
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(0, 0, 5, 5).endFill();
    root.addChild(g);

    const top = asGroup(walkContainer(root));
    expect(top.source).toBe(root);
    expect(top.children).toEqual([]);
  });
});

describe('walkContainer — alpha propagation', () => {
  it('multiplies Graphics fill alpha by the chain of ancestor alphas', () => {
    const root = new Container();
    root.alpha = 0.5;
    const sub = new Container();
    sub.alpha = 0.5;
    const g = new Graphics();
    g.alpha = 0.5;
    g.beginFill(0xff0000, 0.5).drawRect(0, 0, 10, 10).endFill();
    sub.addChild(g);
    root.addChild(sub);

    const top = asGroup(walkContainer(root));
    const subNode = asGroup(top.children[0]);
    const gfx = asGraphics(subNode.children[0]);

    // 0.5 (root) * 0.5 (sub) * 0.5 (g) * 0.5 (fill) = 0.0625
    expect(gfx.commands[0]).toMatchObject({ type: 'fill' });
    expect((gfx.commands[0] as { alpha: number }).alpha).toBeCloseTo(
      0.0625,
      6,
    );
  });

  it('multiplies stroke alpha as well', () => {
    const root = new Container();
    root.alpha = 0.5;
    const g = new Graphics();
    g.lineStyle(2, 0x000000, 0.8).moveTo(0, 0).lineTo(10, 10);
    root.addChild(g);

    const top = asGroup(walkContainer(root));
    const gfx = asGraphics(top.children[0]);

    expect(gfx.commands[0]).toMatchObject({ type: 'stroke' });
    expect((gfx.commands[0] as { alpha: number }).alpha).toBeCloseTo(0.4, 6);
  });

  it('leaves non-style commands (moveTo/lineTo/rect/...) untouched', () => {
    const root = new Container();
    root.alpha = 0.3;
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(5, 6, 7, 8).endFill();
    root.addChild(g);

    const top = asGroup(walkContainer(root));
    const gfx = asGraphics(top.children[0]);
    expect(gfx.commands[1]).toEqual({ type: 'rect', x: 5, y: 6, w: 7, h: 8 });
  });
});
