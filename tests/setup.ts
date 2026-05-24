// Vitest setup: jsdom does not implement HTMLCanvasElement.getContext('2d').
// PIXI's `Texture.WHITE` builds a 16x16 fill canvas lazily on first access
// (triggered by `new Graphics()` → `new FillStyle()`), so the test environment
// needs a minimal 2D-context stub.

const noop = (): void => {};

function createStub2DContext(): unknown {
  return {
    canvas: null as unknown,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    setTransform: noop,
    transform: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    drawImage: noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop,
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    measureText: () => ({ width: 0 }),
    fillText: noop,
    strokeText: noop,
  };
}

if (typeof HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (contextId: string) => unknown;
  };
  const original = proto.getContext;
  proto.getContext = function patchedGetContext(contextId: string): unknown {
    if (contextId === '2d') {
      const ctx = createStub2DContext();
      (ctx as { canvas: unknown }).canvas = this;
      return ctx;
    }
    return original ? original.call(this, contextId) : null;
  };
}
