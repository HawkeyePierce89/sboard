import type { Container, DisplayObject, Sprite, Texture } from 'pixi.js';
import { Container as PixiContainer, Graphics, Sprite as PixiSprite } from 'pixi.js';
import { type DrawCommand, extractCommands } from './graphics-commands';
import { type Matrix2D, getWorldMatrix } from './transform';

export interface SkiaGraphicsNode {
  type: 'graphics';
  matrix: Matrix2D;
  commands: DrawCommand[];
  source: DisplayObject;
}

export interface SkiaSpriteNode {
  type: 'sprite';
  matrix: Matrix2D;
  texture: Texture;
  width: number;
  height: number;
  /**
   * Pixi applies the sprite's anchor at draw time (origin shifts by
   * `-anchor * size`), so the walker stores it on the node so the Skia
   * renderer and the Skia-side hit-test can mirror that shift in local
   * space — otherwise an `anchor.set(0.5)` sprite would be offset by
   * `+w/2, +h/2` relative to its Pixi rendering.
   */
  anchor: { x: number; y: number };
  /**
   * Multiplied alpha along the ancestor chain (same value the walker
   * multiplies into graphics-command alphas). The renderer applies it
   * via `Paint.setAlphaf` so sprites with ancestor or self `alpha < 1`
   * render translucently — matching PIXI's canvas renderer.
   */
  worldAlpha: number;
  /**
   * Numeric RGB tint (0xFFFFFF means "no tint"). Captured from
   * `Sprite.tintValue` so PIXI's `ColorSource` (string/array/etc.) is
   * normalized to a comparable integer.
   */
  tint: number;
  source: DisplayObject;
}

export interface SkiaGroupNode {
  type: 'group';
  matrix: Matrix2D;
  children: SkiaSceneNode[];
  source: DisplayObject;
}

export type SkiaSceneNode = SkiaGraphicsNode | SkiaSpriteNode | SkiaGroupNode;

function applyAlphaToCommands(
  commands: DrawCommand[],
  worldAlpha: number,
): DrawCommand[] {
  if (worldAlpha === 1) return commands;
  return commands.map((cmd) => {
    if (cmd.type === 'fill' || cmd.type === 'stroke') {
      return { ...cmd, alpha: cmd.alpha * worldAlpha };
    }
    return cmd;
  });
}

function walkNode(obj: DisplayObject, parentAlpha: number): SkiaSceneNode | null {
  // Pixi's canvas renderer suppresses a subtree when either `visible` OR
  // `renderable` is false (see @pixi/canvas-display Container.renderCanvas).
  // Mirroring that here keeps the Skia path in lockstep with what Pixi
  // actually draws — without the `renderable` check, an object hidden
  // via `renderable=false` would still appear (and be hit-testable) on
  // the Skia canvas while Pixi silently dropped it.
  if (!obj.visible || !obj.renderable) return null;

  const worldAlpha = parentAlpha * obj.alpha;
  const matrix = getWorldMatrix(obj);

  if (obj instanceof Graphics) {
    return {
      type: 'graphics',
      matrix,
      commands: applyAlphaToCommands(extractCommands(obj), worldAlpha),
      source: obj,
    };
  }

  if (obj instanceof PixiSprite) {
    const sprite = obj as Sprite;
    return {
      type: 'sprite',
      matrix,
      texture: sprite.texture,
      width: sprite.width,
      height: sprite.height,
      anchor: { x: sprite.anchor.x, y: sprite.anchor.y },
      worldAlpha,
      tint: sprite.tintValue,
      source: obj,
    };
  }

  if (obj instanceof PixiContainer) {
    const children: SkiaSceneNode[] = [];
    for (const child of obj.children) {
      const node = walkNode(child, worldAlpha);
      if (node !== null) children.push(node);
    }
    return {
      type: 'group',
      matrix,
      children,
      source: obj,
    };
  }

  return null;
}

export function walkContainer(root: Container): SkiaSceneNode {
  if (!root.visible || !root.renderable) {
    return {
      type: 'group',
      matrix: getWorldMatrix(root),
      children: [],
      source: root,
    };
  }

  const worldAlpha = root.alpha;
  const children: SkiaSceneNode[] = [];
  for (const child of root.children) {
    const node = walkNode(child, worldAlpha);
    if (node !== null) children.push(node);
  }

  return {
    type: 'group',
    matrix: getWorldMatrix(root),
    children,
    source: root,
  };
}
