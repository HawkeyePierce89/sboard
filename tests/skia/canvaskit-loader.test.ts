import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasKit, CanvasKitInitOptions } from 'canvaskit-wasm';
import {
  _resetCanvasKitCacheForTests,
  initCanvasKit,
  type CanvasKitModule,
} from '../../src/skia/canvaskit-loader';

type CapturedInit = ReturnType<typeof vi.fn>;

function makeFakeCanvasKit(tag = 'fake-canvaskit'): CanvasKit {
  return { __tag: tag } as unknown as CanvasKit;
}

function makeInitSpy(
  result: CanvasKit | (() => CanvasKit | Promise<CanvasKit>) = makeFakeCanvasKit(),
): CapturedInit {
  return vi.fn(async (_opts?: CanvasKitInitOptions): Promise<CanvasKit> => {
    if (typeof result === 'function') {
      return await result();
    }
    return result;
  });
}

function makeLoadModule(init: CapturedInit): () => Promise<CanvasKitModule> {
  return vi.fn(async () => ({ default: init }) as CanvasKitModule);
}

describe('initCanvasKit', () => {
  beforeEach(() => {
    _resetCanvasKitCacheForTests();
  });

  it('resolves to the CanvasKit returned by CanvasKitInit', async () => {
    const fake = makeFakeCanvasKit('one');
    const init = makeInitSpy(fake);
    const ck = await initCanvasKit({ loadModule: makeLoadModule(init) });
    expect(ck).toBe(fake);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('passes a locateFile that points at the default /canvaskit/ base path', async () => {
    const init = makeInitSpy();
    await initCanvasKit({ loadModule: makeLoadModule(init) });
    const opts = init.mock.calls[0][0] as CanvasKitInitOptions;
    expect(typeof opts.locateFile).toBe('function');
    expect(opts.locateFile?.('canvaskit.wasm')).toBe(
      '/canvaskit/canvaskit.wasm',
    );
  });

  it('honors a custom basePath when computing locateFile', async () => {
    const init = makeInitSpy();
    await initCanvasKit({
      loadModule: makeLoadModule(init),
      basePath: '/sboard/canvaskit/',
    });
    const opts = init.mock.calls[0][0] as CanvasKitInitOptions;
    expect(opts.locateFile?.('canvaskit.wasm')).toBe(
      '/sboard/canvaskit/canvaskit.wasm',
    );
  });

  it('caches the promise — repeated calls return the same instance and do not reload', async () => {
    const init = makeInitSpy(makeFakeCanvasKit('cached'));
    const loadModule = makeLoadModule(init);
    const first = await initCanvasKit({ loadModule });
    const second = await initCanvasKit({ loadModule });
    expect(second).toBe(first);
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('caches even while still pending — concurrent callers share one load', async () => {
    let resolveInit!: (ck: CanvasKit) => void;
    const init = vi.fn(
      () =>
        new Promise<CanvasKit>((res) => {
          resolveInit = res;
        }),
    );
    const loadModule = makeLoadModule(init as unknown as CapturedInit);

    const p1 = initCanvasKit({ loadModule });
    const p2 = initCanvasKit({ loadModule });
    expect(loadModule).toHaveBeenCalledTimes(1);

    // Let the loadModule promise resolve so init() actually runs and
    // captures resolveInit. A single microtask flush is not enough
    // because loadModule itself is async; loop a few ticks.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const fake = makeFakeCanvasKit('shared');
    resolveInit(fake);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(fake);
    expect(b).toBe(fake);
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('rejects when the module fails to load and clears the cache so retry can succeed', async () => {
    const failingLoad = vi.fn(async (): Promise<CanvasKitModule> => {
      throw new Error('module load failed');
    });
    await expect(initCanvasKit({ loadModule: failingLoad })).rejects.toThrow(
      'module load failed',
    );

    const fake = makeFakeCanvasKit('after-retry');
    const ok = makeInitSpy(fake);
    const ck = await initCanvasKit({ loadModule: makeLoadModule(ok) });
    expect(ck).toBe(fake);
  });

  it('rejects when CanvasKitInit itself throws', async () => {
    const throwingInit = vi.fn(async () => {
      throw new Error('boom in init');
    });
    await expect(
      initCanvasKit({ loadModule: makeLoadModule(throwingInit) }),
    ).rejects.toThrow('boom in init');
  });

  it('rejects when the loaded module has no default export', async () => {
    const loadModule = vi.fn(
      async () => ({}) as unknown as CanvasKitModule,
    );
    await expect(initCanvasKit({ loadModule })).rejects.toThrow(
      /default CanvasKitInit function/,
    );
  });
});

// The default loadModule injects a `<script>` tag and reads
// `globalThis.CanvasKitInit` (because canvaskit.js is a UMD/IIFE bundle
// that defines `var CanvasKitInit` at script scope; dynamic ESM import
// would silently lose it).
describe('initCanvasKit — default loadModule (script injection)', () => {
  beforeEach(() => {
    _resetCanvasKitCacheForTests();
  });

  afterEach(() => {
    delete (globalThis as { CanvasKitInit?: unknown }).CanvasKitInit;
    document.querySelectorAll('script[data-test-canvaskit]').forEach((s) => {
      s.remove();
    });
  });

  it('injects a <script> tag and reads CanvasKitInit off globalThis on load', async () => {
    const fake = makeFakeCanvasKit('via-script');
    const initSpy = makeInitSpy(fake);

    const origAppendChild = HTMLHeadElement.prototype.appendChild;
    const appendSpy = vi
      .spyOn(HTMLHeadElement.prototype, 'appendChild')
      .mockImplementation(function <T extends Node>(this: HTMLHeadElement, node: T): T {
        const result = origAppendChild.call(this, node) as T;
        if (node instanceof HTMLScriptElement) {
          node.setAttribute('data-test-canvaskit', 'true');
          (globalThis as { CanvasKitInit?: unknown }).CanvasKitInit = initSpy;
          queueMicrotask(() => node.dispatchEvent(new Event('load')));
        }
        return result;
      });

    try {
      const ck = await initCanvasKit({ basePath: '/canvaskit/' });
      expect(ck).toBe(fake);
      expect(initSpy).toHaveBeenCalledTimes(1);
      const opts = initSpy.mock.calls[0][0] as CanvasKitInitOptions;
      expect(opts.locateFile?.('canvaskit.wasm')).toBe(
        '/canvaskit/canvaskit.wasm',
      );
    } finally {
      appendSpy.mockRestore();
    }
  });

  it('rejects when the script fires onerror', async () => {
    const appendSpy = vi
      .spyOn(HTMLHeadElement.prototype, 'appendChild')
      .mockImplementation(function <T extends Node>(this: HTMLHeadElement, node: T): T {
        if (node instanceof HTMLScriptElement) {
          node.setAttribute('data-test-canvaskit', 'true');
          queueMicrotask(() => node.dispatchEvent(new Event('error')));
        }
        return node;
      });

    try {
      await expect(initCanvasKit({ basePath: '/canvaskit/' })).rejects.toThrow(
        /failed to load/,
      );
    } finally {
      appendSpy.mockRestore();
    }
  });

  it('rejects when the script loads but CanvasKitInit is not defined globally', async () => {
    const appendSpy = vi
      .spyOn(HTMLHeadElement.prototype, 'appendChild')
      .mockImplementation(function <T extends Node>(this: HTMLHeadElement, node: T): T {
        if (node instanceof HTMLScriptElement) {
          node.setAttribute('data-test-canvaskit', 'true');
          queueMicrotask(() => node.dispatchEvent(new Event('load')));
        }
        return node;
      });

    try {
      await expect(initCanvasKit({ basePath: '/canvaskit/' })).rejects.toThrow(
        /did not define globalThis\.CanvasKitInit/,
      );
    } finally {
      appendSpy.mockRestore();
    }
  });
});
