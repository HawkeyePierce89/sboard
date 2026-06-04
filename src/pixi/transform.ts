import type { DisplayObject } from 'pixi.js';

export type Matrix2D = [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

function computeLocalMatrix(obj: DisplayObject): Matrix2D {
  const { position, pivot, scale, skew, rotation } = obj;

  const cosRSky = Math.cos(rotation + skew.y);
  const sinRSky = Math.sin(rotation + skew.y);
  const negSinRSkx = -Math.sin(rotation - skew.x);
  const cosRSkx = Math.cos(rotation - skew.x);

  const a = cosRSky * scale.x;
  const b = sinRSky * scale.x;
  const c = negSinRSkx * scale.y;
  const d = cosRSkx * scale.y;
  const tx = position.x - (pivot.x * a + pivot.y * c);
  const ty = position.y - (pivot.x * b + pivot.y * d);

  return [a, b, c, d, tx, ty];
}

export function composeMatrices(parent: Matrix2D, local: Matrix2D): Matrix2D {
  const [pa, pb, pc, pd, ptx, pty] = parent;
  const [la, lb, lc, ld, ltx, lty] = local;
  return [
    pa * la + pc * lb,
    pb * la + pd * lb,
    pa * lc + pc * ld,
    pb * lc + pd * ld,
    pa * ltx + pc * lty + ptx,
    pb * ltx + pd * lty + pty,
  ];
}

export function getWorldMatrix(obj: DisplayObject): Matrix2D {
  const chain: DisplayObject[] = [];
  let current: DisplayObject | null = obj;
  while (current) {
    chain.push(current);
    current = (current.parent as DisplayObject | null) ?? null;
  }

  let world: Matrix2D = [...IDENTITY_MATRIX];
  for (let i = chain.length - 1; i >= 0; i--) {
    const local = computeLocalMatrix(chain[i]);
    world = composeMatrices(world, local);
  }
  return world;
}
