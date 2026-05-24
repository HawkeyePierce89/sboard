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

// CanvasKit's `canvaskit.js` is a UMD/IIFE bundle that assigns a global
// `CanvasKitInit` via `var` at script scope. Dynamic `import()` would
// treat it as ESM and the `var` would never leak to `window`, so we load
// it as a classic `<script>` tag and read `globalThis.CanvasKitInit`.
function defaultLoadModule(basePath: string): Promise<CanvasKitModule> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('canvaskit-loader: no document — cannot inject script'));
      return;
    }
    const existing = readGlobalInit();
    if (existing) {
      resolve({ default: existing });
      return;
    }
    const url = `${basePath}canvaskit.js`;
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      const init = readGlobalInit();
      if (init) resolve({ default: init });
      else reject(new Error(`canvaskit-loader: ${url} did not define globalThis.CanvasKitInit`));
    };
    script.onerror = () => reject(new Error(`canvaskit-loader: failed to load ${url}`));
    document.head.appendChild(script);
  });
}

function readGlobalInit(): CanvasKitInitFn | null {
  const g = globalThis as { CanvasKitInit?: CanvasKitInitFn };
  return typeof g.CanvasKitInit === 'function' ? g.CanvasKitInit : null;
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
