import type { CanvasKit, ColorFilter, Image } from 'canvaskit-wasm';
import type { BaseTexture, Container, Texture } from 'pixi.js';
import type { DrawCommand } from '../pixi/graphics-commands';
import type {
  SkiaGraphicsNode,
  SkiaSceneNode,
  SkiaSpriteNode,
} from '../pixi/scene-walker';
import { walkContainer } from '../pixi/scene-walker';
import type { Matrix2D } from '../pixi/transform';
import { IDENTITY_MATRIX, composeMatrices } from '../pixi/transform';
import type { Canvas, MutablePath, Paint } from './types';

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
 * Build an `ImageProvider` that turns a PIXI `Texture` into a CanvasKit
 * `Image` via `MakeImageFromCanvasImageSource`. Caches by `baseTexture`
 * so repeated redraws of the same sprite don't re-upload pixels.
 *
 * Returns `null` for textures whose underlying resource isn't a
 * `CanvasImageSource` (e.g. raw `BufferResource`) or that haven't loaded
 * yet — the renderer treats `null` as a silent skip, which matches what
 * Pixi does for a still-loading texture.
 *
 * Two correctness rules govern what we *insert* into the cache:
 *   - Never cache a `null`/failed result. PIXI image resources start
 *     out unready (`HTMLImageElement` still loading, `Texture.from(url)`
 *     mid-decode); caching the early `null` would poison that
 *     `BaseTexture` for the rest of the app even after the resource
 *     becomes valid.
 *   - Never cache mutable sources (`HTMLCanvasElement`,
 *     `HTMLVideoElement`, `OffscreenCanvas`). Their pixels change
 *     between frames, so a one-shot upload would freeze the Skia /
 *     PDF output on the first frame. Re-upload on every redraw.
 *
 * That leaves `HTMLImageElement` and `ImageBitmap` (immutable once
 * decoded) as the only sources that benefit from caching.
 *
 * Native-memory lifetime: CanvasKit `Image` holds WASM-side pixels that
 * JS GC cannot reclaim — `image.delete()` must be called explicitly.
 * For the uncached (mutable-source) path we therefore track the
 * most-recently-handed-out `Image` per `BaseTexture` and release it
 * just before producing the next one. Without that bookkeeping, every
 * redraw of a canvas-/video-backed sprite would leak a fresh `Image`
 * (its sole use is the `drawImageRect` call inside the renderer, which
 * never deletes the image because immutable cached entries reuse it).
 */
export function defaultImageProvider(canvasKit: CanvasKit): ImageProvider {
  const cache = new WeakMap<BaseTexture, Image>();
  const ephemeral = new WeakMap<BaseTexture, Image>();
  return (texture) => {
    const base = texture.baseTexture;
    const cached = cache.get(base);
    if (cached) return cached;
    const previousEphemeral = ephemeral.get(base);
    if (previousEphemeral) {
      previousEphemeral.delete();
      ephemeral.delete(base);
    }
    const source = extractCanvasImageSource(base);
    if (!source) return null;
    let image: Image | null;
    try {
      image = canvasKit.MakeImageFromCanvasImageSource(source);
    } catch {
      image = null;
    }
    if (image) {
      if (isImmutableSource(source)) {
        cache.set(base, image);
      } else {
        ephemeral.set(base, image);
      }
    }
    return image;
  };
}

function isImmutableSource(source: CanvasImageSource): boolean {
  return (
    (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) ||
    (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)
  );
}

function extractCanvasImageSource(base: BaseTexture): CanvasImageSource | null {
  const resource = (base.resource as { source?: unknown } | undefined) ?? null;
  const source = resource?.source;
  if (!source) return null;
  if (
    (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
    (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) ||
    (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas)
  ) {
    return source as CanvasImageSource;
  }
  return null;
}

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
    let path: MutablePath | null = null;
    let hasGeometry = false;

    const ensurePath = (): MutablePath => {
      if (!path) path = new ck.Path() as MutablePath;
      return path;
    };

    const flush = (): void => {
      if (!path || !hasGeometry) return;
      // Detach the shared `path`/`hasGeometry` state up front so the object is
      // deleted exactly once even if `drawPath` throws: the outer `finally`
      // then sees `path === null` and won't re-delete this same Path.
      const p = path;
      path = null;
      hasGeometry = false;
      try {
        if (fillPaint) canvas.drawPath(p, fillPaint);
        if (strokePaint) canvas.drawPath(p, strokePaint);
      } finally {
        p.delete();
      }
    };

    try {
      for (const cmd of node.commands) {
        switch (cmd.type) {
          case 'fill':
            flush();
            if (fillPaint) {
              fillPaint.delete();
              fillPaint = null;
            }
            fillPaint = this.makeFillPaint(cmd);
            break;
          case 'stroke':
            flush();
            if (strokePaint) {
              strokePaint.delete();
              strokePaint = null;
            }
            strokePaint = this.makeStrokePaint(cmd);
            break;
          case 'moveTo':
            ensurePath().moveTo(cmd.x, cmd.y);
            hasGeometry = true;
            break;
          case 'lineTo':
            ensurePath().lineTo(cmd.x, cmd.y);
            hasGeometry = true;
            break;
          case 'rect':
            ensurePath().addRect(ck.XYWHRect(cmd.x, cmd.y, cmd.w, cmd.h));
            hasGeometry = true;
            break;
          case 'ellipse':
            ensurePath().addOval(
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
            ensurePath().addCircle(cmd.cx, cmd.cy, cmd.r);
            hasGeometry = true;
            break;
          case 'closePath':
            ensurePath().close();
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
      (path as MutablePath | null)?.delete();
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
    const ck = this.canvasKit;
    // The walker's matrix already includes the sprite's scale, so the
    // bitmap dimensions in local space are the texture's pixel size, not
    // `node.width/height` (which is post-scale). Shift the draw origin
    // by `-anchor * size` so the sprite renders the same as PIXI.
    const w = node.texture.width;
    const h = node.texture.height;
    const dstX = -node.anchor.x * w;
    const dstY = -node.anchor.y * h;
    // Use `drawImageRect` with `texture.frame` so atlas/spritesheet
    // frames (where `frame` is a sub-rect of the baseTexture) draw the
    // right portion instead of the entire underlying atlas. For simple
    // `Texture.from(url)` sprites `frame` already covers the full
    // baseTexture, so the call is equivalent to the previous
    // `drawImage` for the untrimmed PNG case the spec exercises.
    // Trimmed-atlas `trim` offsets and frame `rotate` are intentionally
    // not honored — the spec only requires simple PNG sprites and PIXI's
    // canvas renderer is the source of truth for that subset.
    //
    // `frame` is in *logical* units, but the CanvasKit `Image` holds the
    // raw bitmap (= `frame * baseTexture.resolution` pixels). Pixi's
    // canvas renderer multiplies the source rect by `resolution` for
    // exactly that reason; mirror it here so a @2x/@3x PNG samples the
    // right pixels of the underlying bitmap instead of the top-left
    // quadrant.
    const frame = node.texture.frame;
    const resolution = node.texture.baseTexture.resolution;
    const src = ck.XYWHRect(
      frame.x * resolution,
      frame.y * resolution,
      frame.width * resolution,
      frame.height * resolution,
    );
    const dst = ck.XYWHRect(dstX, dstY, w, h);
    const { paint, filter } = this.makeSpritePaint(node);
    try {
      canvas.drawImageRect(image, src, dst, paint);
    } finally {
      paint.delete();
      filter?.delete();
    }
  }

  /**
   * Build the `Paint` used to draw a sprite image. Pixi's canvas
   * renderer multiplies the sprite's `worldAlpha` into the output and
   * multiplies pixel RGB by `tint`; we mirror both via `setAlphaf` and
   * a `Modulate` color filter so a sprite with `alpha < 1` or
   * `tint !== 0xFFFFFF` renders the same on the Skia canvas and in
   * exported PDFs as it does on the Pixi canvas.
   *
   * Both the `Paint` and the optional `ColorFilter` are CanvasKit
   * Embind objects whose WASM-side memory JS GC cannot reclaim, so the
   * caller must `.delete()` each one after the draw. We return the
   * filter alongside the paint instead of relying on the paint's
   * internal reference, because `setColorFilter` only adds a ref to
   * the underlying SkColorFilter — the JS-side Embind wrapper still
   * needs its own explicit release.
   */
  private makeSpritePaint(node: SkiaSpriteNode): {
    paint: Paint;
    filter: ColorFilter | null;
  } {
    const ck = this.canvasKit;
    const paint = new ck.Paint();
    let filter: ColorFilter | null = null;
    // If any of the following Embind calls throws (e.g. WASM OOM,
    // invalid arg in `MakeBlend`/`setColorFilter`), the partially
    // constructed `Paint`/`ColorFilter` would otherwise be orphaned —
    // the caller's `try/finally` only kicks in after this returns.
    try {
      if (node.worldAlpha < 1) {
        paint.setAlphaf(node.worldAlpha);
      }
      if (node.tint !== 0xffffff) {
        filter = ck.ColorFilter.MakeBlend(
          colorToFloat4(node.tint, 1),
          ck.BlendMode.Modulate,
        );
        paint.setColorFilter(filter);
      }
      return { paint, filter };
    } catch (err) {
      filter?.delete();
      paint.delete();
      throw err;
    }
  }
}
