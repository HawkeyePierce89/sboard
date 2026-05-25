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
