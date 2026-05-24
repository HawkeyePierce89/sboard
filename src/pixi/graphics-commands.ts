import type { Graphics } from 'pixi.js';
import { SHAPES } from 'pixi.js';
import type {
  Circle,
  Ellipse,
  GraphicsData,
  Polygon,
  Rectangle,
} from 'pixi.js';

export type DrawCommand =
  | { type: 'fill'; color: number; alpha: number }
  | { type: 'stroke'; width: number; color: number; alpha: number }
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'closePath' };

function emitStyles(out: DrawCommand[], data: GraphicsData): void {
  const { fillStyle, lineStyle } = data;
  if (fillStyle.visible) {
    out.push({ type: 'fill', color: fillStyle.color, alpha: fillStyle.alpha });
  }
  if (lineStyle.visible && lineStyle.width > 0) {
    out.push({
      type: 'stroke',
      width: lineStyle.width,
      color: lineStyle.color,
      alpha: lineStyle.alpha,
    });
  }
}

function emitShape(out: DrawCommand[], data: GraphicsData): void {
  switch (data.shape.type) {
    case SHAPES.RECT: {
      const r = data.shape as Rectangle;
      out.push({ type: 'rect', x: r.x, y: r.y, w: r.width, h: r.height });
      return;
    }
    case SHAPES.ELIP: {
      const e = data.shape as Ellipse;
      out.push({
        type: 'ellipse',
        cx: e.x,
        cy: e.y,
        rx: e.width,
        ry: e.height,
      });
      return;
    }
    case SHAPES.CIRC: {
      const c = data.shape as Circle;
      out.push({ type: 'circle', cx: c.x, cy: c.y, r: c.radius });
      return;
    }
    case SHAPES.POLY: {
      const p = data.shape as Polygon;
      const pts = p.points;
      if (pts.length < 2) return;
      out.push({ type: 'moveTo', x: pts[0], y: pts[1] });
      for (let i = 2; i + 1 < pts.length; i += 2) {
        out.push({ type: 'lineTo', x: pts[i], y: pts[i + 1] });
      }
      if (p.closeStroke) {
        out.push({ type: 'closePath' });
      }
      return;
    }
    default:
      return;
  }
}

export function extractCommands(g: Graphics): DrawCommand[] {
  g.finishPoly();
  const out: DrawCommand[] = [];
  for (const data of g.geometry.graphicsData) {
    emitStyles(out, data);
    emitShape(out, data);
  }
  return out;
}
