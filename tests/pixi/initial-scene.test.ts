import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { buildInitialScene } from '../../src/pixi/initial-scene';
import { extractCommands } from '../../src/pixi/graphics-commands';

describe('buildInitialScene', () => {
  it('returns a fresh Container root with two top-level Graphics + one subContainer', () => {
    const root = buildInitialScene();
    expect(root).toBeInstanceOf(Container);
    expect(root.children).toHaveLength(3);
    expect(root.children[0]).toBeInstanceOf(Graphics);
    expect(root.children[1]).toBeInstanceOf(Graphics);
    expect(root.children[2]).toBeInstanceOf(Container);
  });

  it('positions the subContainer at (75, 50) as the spec requires', () => {
    const root = buildInitialScene();
    const subContainer = root.children[2] as Container;
    expect(subContainer.position.x).toBe(75);
    expect(subContainer.position.y).toBe(50);
    expect(subContainer.children).toHaveLength(2);
    expect(subContainer.children[0]).toBeInstanceOf(Graphics);
    expect(subContainer.children[1]).toBeInstanceOf(Graphics);
  });

  it('tags the spec objects with stable names (g1/g2/subContainer/g3/g4)', () => {
    const root = buildInitialScene();
    expect(root.children[0].name).toBe('g1');
    expect(root.children[1].name).toBe('g2');
    const sub = root.children[2] as Container;
    expect(sub.name).toBe('subContainer');
    expect(sub.children[0].name).toBe('g3');
    expect(sub.children[1].name).toBe('g4');
  });

  it('builds g1 as a filled ellipse and g2 as a filled rect', () => {
    const root = buildInitialScene();
    const g1Cmds = extractCommands(root.children[0] as Graphics);
    expect(g1Cmds.some((c) => c.type === 'fill')).toBe(true);
    expect(g1Cmds.some((c) => c.type === 'ellipse')).toBe(true);

    const g2Cmds = extractCommands(root.children[1] as Graphics);
    expect(g2Cmds.some((c) => c.type === 'fill')).toBe(true);
    expect(g2Cmds.some((c) => c.type === 'rect')).toBe(true);
  });

  it('builds g3 as a stroked line matching the spec (width 10, white, 0,0 → 150,100)', () => {
    const root = buildInitialScene();
    const sub = root.children[2] as Container;
    const cmds = extractCommands(sub.children[0] as Graphics);
    const stroke = cmds.find((c) => c.type === 'stroke');
    expect(stroke).toMatchObject({ type: 'stroke', width: 10, color: 0xffffff });
    expect(cmds).toContainEqual({ type: 'moveTo', x: 0, y: 0 });
    expect(cmds).toContainEqual({ type: 'lineTo', x: 150, y: 100 });
  });

  it('builds g4 as a second stroked line in the subContainer', () => {
    const root = buildInitialScene();
    const sub = root.children[2] as Container;
    const cmds = extractCommands(sub.children[1] as Graphics);
    expect(cmds.some((c) => c.type === 'stroke')).toBe(true);
    expect(cmds.some((c) => c.type === 'moveTo')).toBe(true);
    expect(cmds.some((c) => c.type === 'lineTo')).toBe(true);
  });

  it('returns independent instances on each call (no shared mutable state)', () => {
    const a = buildInitialScene();
    const b = buildInitialScene();
    expect(a).not.toBe(b);
    expect(a.children[0]).not.toBe(b.children[0]);
  });
});
