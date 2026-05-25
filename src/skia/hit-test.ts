import type { DisplayObject } from 'pixi.js';
import type { DrawCommand } from '../pixi/graphics-commands';
import type {
  SkiaGraphicsNode,
  SkiaSceneNode,
  SkiaSpriteNode,
} from '../pixi/scene-walker';
import type { Matrix2D } from '../pixi/transform';
import { invertMatrix2D } from './renderer';

interface Point {
  x: number;
  y: number;
}

function applyMatrixToPoint(m: Matrix2D, x: number, y: number): Point {
  const [a, b, c, d, tx, ty] = m;
  return { x: a * x + c * y + tx, y: b * x + d * y + ty };
}

/**
 * Walk a `SkiaSceneNode` tree top-down and find the visually top-most
 * leaf (graphics or sprite) whose geometry contains the world-space
 * point `(x, y)`. Returns the source `DisplayObject` of that leaf, or
 * `null` if nothing was hit.
 *
 * Children are tested in reverse order because the renderer draws them
 * forward, so the last child paints on top of its siblings — and the
 * top-most child wins for hit-testing.
 *
 * The walker stores **world** matrices on every node, so we apply
 * `inv(node.matrix)` once at each leaf to convert the world-space point
 * back into the leaf's local space, then test the leaf's geometry there.
 * Group nodes have no geometry of their own and only forward the test
 * to their children.
 */
export function hitTest(
  node: SkiaSceneNode,
  x: number,
  y: number,
): DisplayObject | null {
  if (node.type === 'group') {
    for (let i = node.children.length - 1; i >= 0; i--) {
      const found = hitTest(node.children[i], x, y);
      if (found) return found;
    }
    return null;
  }

  const inv = invertMatrix2D(node.matrix);
  const local = applyMatrixToPoint(inv, x, y);

  if (node.type === 'sprite') {
    return hitSprite(node, local) ? node.source : null;
  }
  return hitGraphics(node, local) ? node.source : null;
}

function hitSprite(node: SkiaSpriteNode, p: Point): boolean {
  // `node.width`/`node.height` are the post-scale visual dimensions, but
  // we already converted the test point into local space by applying
  // `inv(node.matrix)` (which contains the sprite's scale). The local
  // bounds therefore come from the texture itself — the renderer draws
  // the image at local (-anchor.x*w, -anchor.y*h) (anchor mirrors PIXI's
  // draw-time origin shift), so the hit rectangle is offset accordingly.
  const w = node.texture.width;
  const h = node.texture.height;
  if (w <= 0 || h <= 0) return false;
  const minX = -node.anchor.x * w;
  const minY = -node.anchor.y * h;
  return p.x >= minX && p.x <= minX + w && p.y >= minY && p.y <= minY + h;
}

interface GraphicsState {
  fillActive: boolean;
  strokeActive: boolean;
  strokeWidth: number;
  lastPoint: Point | null;
  firstPoint: Point | null;
  polyVerts: Point[];
}

function freshState(): GraphicsState {
  return {
    fillActive: false,
    strokeActive: false,
    strokeWidth: 0,
    lastPoint: null,
    firstPoint: null,
    polyVerts: [],
  };
}

function resetGeometry(s: GraphicsState): void {
  s.lastPoint = null;
  s.firstPoint = null;
  s.polyVerts = [];
}

function hitGraphics(node: SkiaGraphicsNode, p: Point): boolean {
  const s = freshState();

  for (const cmd of node.commands) {
    if (cmd.type === 'fill' || cmd.type === 'stroke') {
      applyStyle(s, cmd);
      resetGeometry(s);
      continue;
    }

    if (cmd.type === 'endEntry') {
      // Pixi's canvas renderer (and Skia's path fill) treats an open
      // polyline as implicitly closed for the fill computation —
      // `ctx.fill()` / `drawPath(path, fill)` close the subpath even
      // when no explicit `closePath` was emitted. So a polyline built
      // via `beginFill().moveTo().lineTo()...endFill()` (closeStroke
      // false) is visually a filled polygon and must be hit-testable
      // as one. Mirror that here before resetting the entry state.
      if (
        s.fillActive &&
        s.polyVerts.length >= 3 &&
        pointInPolygon(p, s.polyVerts)
      ) {
        return true;
      }
      // Clear both paint slots and geometry so the next graphicsData
      // entry starts fresh. Without this, a fill/stroke set in entry N
      // would still be "active" while we test commands from entry N+1
      // that omit the corresponding style command.
      s.fillActive = false;
      s.strokeActive = false;
      s.strokeWidth = 0;
      resetGeometry(s);
      continue;
    }

    if (testShapeCommand(s, p, cmd)) return true;
  }
  return false;
}

function applyStyle(
  s: GraphicsState,
  cmd: Extract<DrawCommand, { type: 'fill' } | { type: 'stroke' }>,
): void {
  if (cmd.type === 'fill') {
    s.fillActive = cmd.alpha > 0;
  } else {
    s.strokeActive = cmd.alpha > 0;
    s.strokeWidth = cmd.width;
  }
}

function testShapeCommand(
  s: GraphicsState,
  p: Point,
  cmd: DrawCommand,
): boolean {
  switch (cmd.type) {
    case 'rect':
      return hitRect(
        p,
        cmd.x,
        cmd.y,
        cmd.w,
        cmd.h,
        s.fillActive,
        s.strokeActive,
        s.strokeWidth,
      );
    case 'ellipse':
      return hitEllipse(
        p,
        cmd.cx,
        cmd.cy,
        cmd.rx,
        cmd.ry,
        s.fillActive,
        s.strokeActive,
        s.strokeWidth,
      );
    case 'circle':
      return hitEllipse(
        p,
        cmd.cx,
        cmd.cy,
        cmd.r,
        cmd.r,
        s.fillActive,
        s.strokeActive,
        s.strokeWidth,
      );
    case 'moveTo': {
      const pt = { x: cmd.x, y: cmd.y };
      s.firstPoint = pt;
      s.lastPoint = pt;
      s.polyVerts = [pt];
      return false;
    }
    case 'lineTo': {
      const to = { x: cmd.x, y: cmd.y };
      const hit =
        s.strokeActive &&
        s.lastPoint !== null &&
        distanceToSegment(p, s.lastPoint, to) <= s.strokeWidth / 2;
      s.polyVerts.push(to);
      s.lastPoint = to;
      return hit;
    }
    case 'closePath': {
      if (
        s.strokeActive &&
        s.lastPoint !== null &&
        s.firstPoint !== null &&
        distanceToSegment(p, s.lastPoint, s.firstPoint) <= s.strokeWidth / 2
      ) {
        return true;
      }
      if (
        s.fillActive &&
        s.polyVerts.length >= 3 &&
        pointInPolygon(p, s.polyVerts)
      ) {
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

function hitRect(
  p: Point,
  x: number,
  y: number,
  w: number,
  h: number,
  fillActive: boolean,
  strokeActive: boolean,
  strokeWidth: number,
): boolean {
  if (!fillActive && !strokeActive) return false;
  const half = strokeActive ? strokeWidth / 2 : 0;
  const minX = x - half;
  const maxX = x + w + half;
  const minY = y - half;
  const maxY = y + h + half;
  if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return false;
  if (fillActive) return true;
  // Stroke only — exclude the inner clear region.
  const innerMinX = x + half;
  const innerMaxX = x + w - half;
  const innerMinY = y + half;
  const innerMaxY = y + h - half;
  if (innerMinX < innerMaxX && innerMinY < innerMaxY) {
    if (
      p.x > innerMinX &&
      p.x < innerMaxX &&
      p.y > innerMinY &&
      p.y < innerMaxY
    ) {
      return false;
    }
  }
  return true;
}

function hitEllipse(
  p: Point,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fillActive: boolean,
  strokeActive: boolean,
  strokeWidth: number,
): boolean {
  if (!fillActive && !strokeActive) return false;
  if (rx <= 0 || ry <= 0) return false;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (fillActive) {
    if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) return true;
  }
  if (strokeActive) {
    const half = strokeWidth / 2;
    const outerRx = rx + half;
    const outerRy = ry + half;
    if (
      (dx * dx) / (outerRx * outerRx) + (dy * dy) / (outerRy * outerRy) >
      1
    ) {
      return false;
    }
    const innerRx = rx - half;
    const innerRy = ry - half;
    if (innerRx > 0 && innerRy > 0) {
      const insideInner =
        (dx * dx) / (innerRx * innerRx) + (dy * dy) / (innerRy * innerRy) < 1;
      if (insideInner) return false;
    }
    return true;
  }
  return false;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return Math.sqrt(px * px + py * py);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cxp = a.x + t * dx;
  const cyp = a.y + t * dy;
  const px = p.x - cxp;
  const py = p.y - cyp;
  return Math.sqrt(px * px + py * py);
}

function pointInPolygon(p: Point, verts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x;
    const yi = verts[i].y;
    const xj = verts[j].x;
    const yj = verts[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
