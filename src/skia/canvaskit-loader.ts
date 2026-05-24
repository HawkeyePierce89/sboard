import type { CanvasKit, CanvasKitInitOptions } from 'canvaskit-wasm';

export type CanvasKitInitFn = (
  opts?: CanvasKitInitOptions,
) => Promise<CanvasKit>;

export interface CanvasKitModule {
  default: CanvasKitInitFn;
}

export interface InitCanvasKitOptions {
  basePath?: string;
  loadModule?: () => Promise<CanvasKitModule>;
}

const DEFAULT_BASE_PATH = '/canvaskit/';

let cached: Promise<CanvasKit> | null = null;

function defaultLoadModule(basePath: string): Promise<CanvasKitModule> {
  const url = `${basePath}canvaskit.js`;
  return import(/* @vite-ignore */ url) as Promise<CanvasKitModule>;
}

export function initCanvasKit(
  options: InitCanvasKitOptions = {},
): Promise<CanvasKit> {
  if (cached) return cached;

  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const loadModule = options.loadModule ?? (() => defaultLoadModule(basePath));

  const promise = (async (): Promise<CanvasKit> => {
    const mod = await loadModule();
    const init = mod.default;
    if (typeof init !== 'function') {
      throw new Error(
        'canvaskit.js did not expose a default CanvasKitInit function',
      );
    }
    return init({
      locateFile: (file: string) => `${basePath}${file}`,
    });
  })();

  cached = promise.catch((err: unknown) => {
    cached = null;
    throw err;
  }) as Promise<CanvasKit>;

  return cached;
}

export function _resetCanvasKitCacheForTests(): void {
  cached = null;
}
