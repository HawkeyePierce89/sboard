import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import {
  IDENTITY_MATRIX,
  composeMatrices,
  getWorldMatrix,
  type Matrix2D,
} from '../../src/pixi/transform';

function expectMatrixApprox(
  actual: Matrix2D,
  expected: Matrix2D,
  precision = 6,
): void {
  for (let i = 0; i < 6; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], precision);
  }
}

describe('getWorldMatrix', () => {
  it('returns the identity matrix for a default DisplayObject', () => {
    const obj = new Container();
    expect(getWorldMatrix(obj)).toEqual([...IDENTITY_MATRIX]);
  });

  it('returns a pure translation for position.set(x, y)', () => {
    const obj = new Container();
    obj.position.set(50, 100);
    expectMatrixApprox(getWorldMatrix(obj), [1, 0, 0, 1, 50, 100]);
  });

  it('returns a pure rotation for angle = 30° (π/6 rad)', () => {
    const obj = new Container();
    obj.angle = 30;
    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    expectMatrixApprox(getWorldMatrix(obj), [cos, sin, -sin, cos, 0, 0]);
  });

  it('returns a pure scale for scale.set(sx, sy)', () => {
    const obj = new Container();
    obj.scale.set(2, 3);
    expectMatrixApprox(getWorldMatrix(obj), [2, 0, 0, 3, 0, 0]);
  });

  it('composes parent + child transforms (spec example: subContainer @ (75,50) → g3)', () => {
    const sub = new Container();
    sub.position.set(75, 50);
    const g3 = new Container();
    sub.addChild(g3);
    expectMatrixApprox(getWorldMatrix(g3), [1, 0, 0, 1, 75, 50]);
  });

  it('adds child translation on top of parent translation', () => {
    const parent = new Container();
    parent.position.set(100, 50);
    const child = new Container();
    child.position.set(10, 20);
    parent.addChild(child);
    expectMatrixApprox(getWorldMatrix(child), [1, 0, 0, 1, 110, 70]);
  });

  it('propagates parent rotation onto child position (90° rotates +x into +y in screen space)', () => {
    const parent = new Container();
    parent.angle = 90;
    const child = new Container();
    child.position.set(10, 0);
    parent.addChild(child);
    const m = getWorldMatrix(child);
    // Parent rotation matrix is [0, 1, -1, 0, 0, 0]; multiplying by
    // child translation (10, 0) yields world position (0, 10).
    expect(m[4]).toBeCloseTo(0, 6);
    expect(m[5]).toBeCloseTo(10, 6);
  });

  it('combines translate + rotate + scale on a single object', () => {
    const obj = new Container();
    obj.position.set(10, 20);
    obj.rotation = Math.PI / 4;
    obj.scale.set(2, 2);
    const k = Math.SQRT2; // cos(π/4)·2 = sin(π/4)·2 = √2
    expectMatrixApprox(getWorldMatrix(obj), [k, k, -k, k, 10, 20]);
  });

  it('respects pivot when computing the translation component', () => {
    const obj = new Container();
    obj.pivot.set(5, 0);
    obj.position.set(10, 0);
    obj.rotation = Math.PI / 2;
    // a = cos(π/2) = 0, b = sin(π/2) = 1, c = -1, d = 0
    // tx = position.x - (pivot.x*a + pivot.y*c) = 10 - (5*0 + 0*-1) = 10
    // ty = position.y - (pivot.x*b + pivot.y*d) =  0 - (5*1 + 0*0)  = -5
    expectMatrixApprox(getWorldMatrix(obj), [0, 1, -1, 0, 10, -5]);
  });

  it('does not depend on PIXI.DisplayObject.worldTransform (stale before any render)', () => {
    const obj = new Container();
    obj.position.set(42, 7);
    // worldTransform is not refreshed until updateTransform() runs as part
    // of a render pass — assert getWorldMatrix is correct without it.
    expectMatrixApprox(getWorldMatrix(obj), [1, 0, 0, 1, 42, 7]);
  });
});

describe('composeMatrices', () => {
  it('returns identity when composing identity with identity', () => {
    expect(composeMatrices(IDENTITY_MATRIX, IDENTITY_MATRIX)).toEqual([
      ...IDENTITY_MATRIX,
    ]);
  });

  it('combines two translations by adding their offsets', () => {
    const a: Matrix2D = [1, 0, 0, 1, 10, 20];
    const b: Matrix2D = [1, 0, 0, 1, 5, -5];
    expect(composeMatrices(a, b)).toEqual([1, 0, 0, 1, 15, 15]);
  });

  it('applies parent rotation to child translation (P · L) instead of (L · P)', () => {
    // Parent: 90° rotation. Child: translate (10, 0).
    const parent: Matrix2D = [0, 1, -1, 0, 0, 0];
    const child: Matrix2D = [1, 0, 0, 1, 10, 0];
    const out = composeMatrices(parent, child);
    expect(out[4]).toBeCloseTo(0, 6);
    expect(out[5]).toBeCloseTo(10, 6);
  });
});
