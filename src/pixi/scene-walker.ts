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
  if (!obj.visible) return null;

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
  if (!root.visible) {
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
