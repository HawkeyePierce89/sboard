import type { CanvasKit, Image, PathBuilder } from 'canvaskit-wasm';
import type { Container, Texture } from 'pixi.js';
import type { DrawCommand } from '../pixi/graphics-commands';
import type {
  SkiaGraphicsNode,
  SkiaSceneNode,
  SkiaSpriteNode,
} from '../pixi/scene-walker';
import { walkContainer } from '../pixi/scene-walker';
import type { Matrix2D } from '../pixi/transform';
import { IDENTITY_MATRIX, composeMatrices } from '../pixi/transform';
import type { Canvas, Paint } from './types';

/**
 * Convert a PIXI affine matrix `[a, b, c, d, tx, ty]` into a 9-entry
 * row-major Skia 3x3 matrix:
 *
 *   | a c tx |
 *   | b d ty |
 *   | 0 0  1 |
 */
export function pixiMatrixToSkia(m: Matrix2D): number[] {
  const [a, b, c, d, tx, ty] = m;
  return [a, c, tx, b, d, ty, 0, 0, 1];
}

/**
 * Closed-form inverse of an affine 2x3 PIXI matrix. Returns the identity
 * for degenerate (non-invertible) matrices so the renderer can still
 * progress without crashing on a misconfigured node.
 */
export function invertMatrix2D(m: Matrix2D): Matrix2D {
  const [a, b, c, d, tx, ty] = m;
  const det = a * d - b * c;
  if (det === 0) return [...IDENTITY_MATRIX] as Matrix2D;
  const inv = 1 / det;
  return [
    d * inv,
    -b * inv,
    -c * inv,
    a * inv,
    (c * ty - d * tx) * inv,
    (b * tx - a * ty) * inv,
  ];
}

export function colorToFloat4(color: number, alpha: number): Float32Array {
  const r = ((color >>> 16) & 0xff) / 255;
  const g = ((color >>> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return Float32Array.of(r, g, b, alpha);
}

export type ImageProvider = (texture: Texture) => Image | null;

/**
 * Walks a `SkiaSceneNode` tree and emits the matching CanvasKit draw calls.
 *
 * The scene-walker stores **world** matrices per node (see
 * `getWorldMatrix`), so when descending the tree we have to derive the
 * **local** matrix at each step (`inv(parentWorld) * nodeWorld`) before
 * concating it onto the canvas; otherwise the parent transform would be
 * applied twice in nested groups.
 *
 * Sprite drawing requires turning a PIXI `Texture` into a CanvasKit
 * `Image`. That conversion is environment-dependent (image decoding,
 * `MakeImageFromCanvasImageSource`, etc.) and is therefore injected as
 * the `imageProvider` callback — tests can stub it without booting the
 * full WASM module.
 */
export class PixiToSkiaRenderer {
  private readonly canvasKit: CanvasKit;
  private readonly imageProvider: ImageProvider | undefined;

  constructor(canvasKit: CanvasKit, imageProvider?: ImageProvider) {
    this.canvasKit = canvasKit;
    this.imageProvider = imageProvider;
  }

  render(
    canvas: Canvas,
    node: SkiaSceneNode,
    parentWorld: Matrix2D = IDENTITY_MATRIX,
  ): void {
    const local = composeMatrices(invertMatrix2D(parentWorld), node.matrix);
    canvas.save();
    canvas.concat(pixiMatrixToSkia(local));
    try {
      switch (node.type) {
        case 'group':
          for (const child of node.children) {
            this.render(canvas, child, node.matrix);
          }
          break;
        case 'graphics':
          this.drawGraphics(canvas, node);
          break;
        case 'sprite':
          this.drawSprite(canvas, node);
          break;
      }
    } finally {
      canvas.restore();
    }
  }

  renderContainer(canvas: Canvas, container: Container): void {
    this.render(canvas, walkContainer(container));
  }

  private drawGraphics(canvas: Canvas, node: SkiaGraphicsNode): void {
    const ck = this.canvasKit;
    let fillPaint: Paint | null = null;
    let strokePaint: Paint | null = null;
    let builder: PathBuilder | null = null;
    let hasGeometry = false;

    const ensureBuilder = (): PathBuilder => {
      if (!builder) builder = new ck.PathBuilder();
      return builder;
    };

    const flush = (): void => {
      if (!builder || !hasGeometry) return;
      const path = builder.detach();
      try {
        if (fillPaint) canvas.drawPath(path, fillPaint);
        if (strokePaint) canvas.drawPath(path, strokePaint);
      } finally {
        path.delete();
      }
      builder.delete();
      builder = null;
      hasGeometry = false;
    };

    try {
      for (const cmd of node.commands) {
        switch (cmd.type) {
          case 'fill':
            flush();
            if (fillPaint) fillPaint.delete();
            fillPaint = this.makeFillPaint(cmd);
            break;
          case 'stroke':
            flush();
            if (strokePaint) strokePaint.delete();
            strokePaint = this.makeStrokePaint(cmd);
            break;
          case 'moveTo':
            ensureBuilder().moveTo(cmd.x, cmd.y);
            hasGeometry = true;
            break;
          case 'lineTo':
            ensureBuilder().lineTo(cmd.x, cmd.y);
            hasGeometry = true;
            break;
          case 'rect':
            ensureBuilder().addRect(ck.XYWHRect(cmd.x, cmd.y, cmd.w, cmd.h));
            hasGeometry = true;
            break;
          case 'ellipse':
            ensureBuilder().addOval(
              ck.LTRBRect(
                cmd.cx - cmd.rx,
                cmd.cy - cmd.ry,
                cmd.cx + cmd.rx,
                cmd.cy + cmd.ry,
              ),
            );
            hasGeometry = true;
            break;
          case 'circle':
            ensureBuilder().addCircle(cmd.cx, cmd.cy, cmd.r);
            hasGeometry = true;
            break;
          case 'closePath':
            ensureBuilder().close();
            break;
          case 'endEntry':
            flush();
            if (fillPaint) {
              fillPaint.delete();
              fillPaint = null;
            }
            if (strokePaint) {
              strokePaint.delete();
              strokePaint = null;
            }
            break;
        }
      }
      flush();
    } finally {
      if (fillPaint) fillPaint.delete();
      if (strokePaint) strokePaint.delete();
      (builder as PathBuilder | null)?.delete();
    }
  }

  private makeFillPaint(cmd: Extract<DrawCommand, { type: 'fill' }>): Paint {
    const ck = this.canvasKit;
    const paint = new ck.Paint();
    paint.setStyle(ck.PaintStyle.Fill);
    paint.setColor(colorToFloat4(cmd.color, cmd.alpha));
    paint.setAntiAlias(true);
    return paint;
  }

  private makeStrokePaint(cmd: Extract<DrawCommand, { type: 'stroke' }>): Paint {
    const ck = this.canvasKit;
    const paint = new ck.Paint();
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setStrokeWidth(cmd.width);
    paint.setColor(colorToFloat4(cmd.color, cmd.alpha));
    paint.setAntiAlias(true);
    return paint;
  }

  private drawSprite(canvas: Canvas, node: SkiaSpriteNode): void {
    if (!this.imageProvider) return;
    const image = this.imageProvider(node.texture);
    if (!image) return;
    canvas.drawImage(image, 0, 0, null);
  }
}
