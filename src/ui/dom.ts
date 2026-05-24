export class DomLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomLookupError';
  }
}

type Constructor<T> = new (...args: never[]) => T;

export function getElementById<T extends Element>(
  id: string,
  expected: Constructor<T>,
): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new DomLookupError(`Element with id "${id}" not found in the document`);
  }
  if (!(el instanceof expected)) {
    throw new DomLookupError(
      `Element with id "${id}" is not an instance of ${expected.name}`,
    );
  }
  return el;
}

export function getCanvasById(id: string): HTMLCanvasElement {
  return getElementById(id, HTMLCanvasElement);
}

export function getButtonById(id: string): HTMLButtonElement {
  return getElementById(id, HTMLButtonElement);
}

export interface CanvasDimensions {
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  dpr: number;
}

export function configureCanvasForDPR(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
): CanvasDimensions {
  const safeDpr = dpr > 0 ? dpr : 1;
  const pixelWidth = Math.max(1, Math.round(cssWidth * safeDpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * safeDpr));
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  return { cssWidth, cssHeight, pixelWidth, pixelHeight, dpr: safeDpr };
}
