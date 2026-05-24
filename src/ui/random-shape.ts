import { Container, Graphics } from 'pixi.js';

export interface Bounds {
  w: number;
  h: number;
}

export type RandomShapeType = 'rect' | 'ellipse' | 'line' | 'polygon';

export interface AddRandomShapeOptions {
  /**
   * Source of randomness — injected so tests can drive the function
   * deterministically without globally patching `Math.random`. Defaults
   * to `Math.random`.
   */
  random?: () => number;
  /**
   * Override for the generated object's `name`. Without it, the shape is
   * tagged `random:<type>` so the status reporter has something to print
   * when the user clicks it.
   */
  name?: string;
}

const SHAPE_TYPES: readonly RandomShapeType[] = [
  'rect',
  'ellipse',
  'line',
  'polygon',
];

/**
 * Build a random PIXI.Graphics and add it to `container`. Shape geometry
 * is drawn around (0, 0) so position/rotation/scale on the returned
 * object behave intuitively. The caller is responsible for attaching
 * event listeners and triggering a redraw afterwards.
 */
export function addRandomShape(
  container: Container,
  bounds: Bounds,
  options: AddRandomShapeOptions = {},
): Graphics {
  const random = options.random ?? Math.random;
  const type = SHAPE_TYPES[Math.floor(random() * SHAPE_TYPES.length)];
  const g = drawShape(type, random);
  g.name = options.name ?? `random:${type}`;
  g.position.set(random() * bounds.w, random() * bounds.h);
  g.rotation = random() * Math.PI * 2;
  const scale = 0.5 + random();
  g.scale.set(scale, scale);
  container.addChild(g);
  return g;
}

function drawShape(type: RandomShapeType, random: () => number): Graphics {
  const g = new Graphics();
  const color = randomColor(random);
  switch (type) {
    case 'rect': {
      const w = 20 + random() * 80;
      const h = 20 + random() * 80;
      g.beginFill(color, 1)
        .drawRect(-w / 2, -h / 2, w, h)
        .endFill();
      return g;
    }
    case 'ellipse': {
      const rx = 15 + random() * 40;
      const ry = 15 + random() * 40;
      g.beginFill(color, 1).drawEllipse(0, 0, rx, ry).endFill();
      return g;
    }
    case 'line': {
      const dx = -50 + random() * 100;
      const dy = -50 + random() * 100;
      const width = 2 + random() * 8;
      g.lineStyle(width, color, 1).moveTo(0, 0).lineTo(dx, dy);
      return g;
    }
    case 'polygon': {
      const radius = 20 + random() * 40;
      const points: number[] = [];
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2 + random() * 0.5;
        points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      const strokeColor = randomColor(random);
      const strokeWidth = 2 + random() * 4;
      g.lineStyle(strokeWidth, strokeColor, 1)
        .beginFill(color, 0.8)
        .drawPolygon(points)
        .endFill();
      return g;
    }
  }
}

function randomColor(random: () => number): number {
  return Math.floor(random() * 0xffffff);
}
