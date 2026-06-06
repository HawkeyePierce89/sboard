import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import type { CanvasKit } from 'canvaskit-wasm';
import {
  PDFExportFailedError,
  PDFExportNotSupportedError,
  exportToPDF,
  hasPDFSupport,
} from '../../src/skia/pdf-exporter';
import type {
  CanvasKitWithPDF,
  PDFDocument,
  PDFMetadata,
} from '../../src/skia/types';

interface SpyPDFDocument extends PDFDocument {
  _beginPageCalls: Array<[number, number]>;
  _endPageCalled: number;
  _closeCalled: number;
  _deleteCalled: number;
  _output: Uint8Array;
}

interface MockPDFCanvasKit {
  ck: CanvasKitWithPDF;
  docs: SpyPDFDocument[];
  pageCanvasFor: (doc: SpyPDFDocument) => unknown;
}

function makePageCanvas(): unknown {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    concat: vi.fn(),
    drawPath: vi.fn(),
    drawImageRect: vi.fn(),
  };
}

function makeMockPDFCanvasKit(
  outputFactory: () => Uint8Array = () =>
    new TextEncoder().encode('%PDF-1.4\n%mock-body\n%%EOF\n'),
  opts: { beginPageReturnsNull?: boolean } = {},
): MockPDFCanvasKit {
  const docs: SpyPDFDocument[] = [];
  const pageCanvases = new WeakMap<SpyPDFDocument, unknown>();

  const MakePDFDocument = vi.fn((_metadata?: PDFMetadata) => {
    const pageCanvas = makePageCanvas();
    const doc: SpyPDFDocument = {
      _beginPageCalls: [],
      _endPageCalled: 0,
      _closeCalled: 0,
      _deleteCalled: 0,
      _output: outputFactory(),
      beginPage(width: number, height: number) {
        this._beginPageCalls.push([width, height]);
        return (opts.beginPageReturnsNull ? null : pageCanvas) as never;
      },
      endPage() {
        this._endPageCalled += 1;
      },
      close() {
        this._closeCalled += 1;
      },
      getOutput() {
        return this._output;
      },
      delete() {
        this._deleteCalled += 1;
      },
    };
    docs.push(doc);
    pageCanvases.set(doc, pageCanvas);
    return doc;
  });

  // Minimal CanvasKit surface required by PixiToSkiaRenderer. These must be
  // constructable (`new ck.Paint()`), so use `function` factories.
  const PaintCtor = vi.fn(function MockPaint() {
    return {
      setStyle: vi.fn(),
      setColor: vi.fn(),
      setStrokeWidth: vi.fn(),
      setAntiAlias: vi.fn(),
      delete: vi.fn(),
    };
  });
  const PathCtor = vi.fn(function MockPath() {
    return {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      addRect: vi.fn(),
      addOval: vi.fn(),
      addCircle: vi.fn(),
      close: vi.fn(),
      delete: vi.fn(),
    };
  });

  const ck = {
    Paint: PaintCtor,
    Path: PathCtor,
    PaintStyle: { Fill: 'FILL', Stroke: 'STROKE' },
    XYWHRect: (x: number, y: number, w: number, h: number) =>
      [x, y, x + w, y + h] as unknown,
    LTRBRect: (l: number, t: number, r: number, b: number) =>
      [l, t, r, b] as unknown,
    MakePDFDocument,
  } as unknown as CanvasKitWithPDF;

  return {
    ck,
    docs,
    pageCanvasFor: (doc) => pageCanvases.get(doc),
  };
}

describe('hasPDFSupport', () => {
  it('returns true when MakePDFDocument is a function on the CanvasKit module', () => {
    const ck = { MakePDFDocument: () => undefined } as unknown as CanvasKit;
    expect(hasPDFSupport(ck)).toBe(true);
  });

  it('returns false when MakePDFDocument is absent (stock build)', () => {
    expect(hasPDFSupport({} as CanvasKit)).toBe(false);
  });

  it('returns false when MakePDFDocument is present but not a function', () => {
    const ck = { MakePDFDocument: 'oops' } as unknown as CanvasKit;
    expect(hasPDFSupport(ck)).toBe(false);
  });
});

describe('exportToPDF — happy path', () => {
  let mock: MockPDFCanvasKit;
  beforeEach(() => {
    mock = makeMockPDFCanvasKit();
  });

  it('produces an application/pdf Blob containing the bytes from getOutput()', async () => {
    const root = new Container();
    const blob = await exportToPDF(mock.ck, root, 400, 300);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');

    const buffer = await blob.arrayBuffer();
    const head = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 5));
    expect(head).toBe('%PDF-');
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('opens exactly one page with the given width/height and closes the doc once', async () => {
    const root = new Container();
    await exportToPDF(mock.ck, root, 640, 480);

    expect(mock.docs).toHaveLength(1);
    const doc = mock.docs[0];
    expect(doc._beginPageCalls).toEqual([[640, 480]]);
    expect(doc._endPageCalled).toBe(1);
    expect(doc._closeCalled).toBe(1);
    expect(doc._deleteCalled).toBe(1);
  });

  it('forwards optional metadata to MakePDFDocument', async () => {
    const root = new Container();
    const metadata: PDFMetadata = { title: 'Scene', author: 'sboard' };
    await exportToPDF(mock.ck, root, 100, 100, { metadata });

    expect(mock.ck.MakePDFDocument).toHaveBeenCalledTimes(1);
    expect((mock.ck.MakePDFDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(
      metadata,
    );
  });

  it('renders the scene into the PDF page canvas (save/concat at minimum)', async () => {
    const root = new Container();
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(10, 20, 30, 40).endFill();
    root.addChild(g);

    await exportToPDF(mock.ck, root, 200, 200);

    const doc = mock.docs[0];
    const pageCanvas = mock.pageCanvasFor(doc) as {
      save: ReturnType<typeof vi.fn>;
      concat: ReturnType<typeof vi.fn>;
      restore: ReturnType<typeof vi.fn>;
      drawPath: ReturnType<typeof vi.fn>;
    };
    // The root group + the graphics node each contribute one save/concat/restore.
    expect(pageCanvas.save).toHaveBeenCalled();
    expect(pageCanvas.restore).toHaveBeenCalled();
    expect(pageCanvas.concat).toHaveBeenCalled();
    expect(pageCanvas.drawPath).toHaveBeenCalled();
  });
});

describe('exportToPDF — failure modes', () => {
  it('throws PDFExportNotSupportedError when MakePDFDocument is missing', async () => {
    const root = new Container();
    const ckWithoutPDF = {
      // Minimal surface so the renderer constructor doesn't get to use it.
      Paint: vi.fn(),
      Path: vi.fn(),
    } as unknown as CanvasKit;

    await expect(exportToPDF(ckWithoutPDF, root, 100, 100)).rejects.toBeInstanceOf(
      PDFExportNotSupportedError,
    );
  });

  it('still closes the document if rendering throws (resources released)', async () => {
    const mock = makeMockPDFCanvasKit();
    const root = new Container();
    // Cause render() to explode by stubbing Path to throw on construction.
    (mock.ck as unknown as { Path: unknown }).Path = function ThrowingPath() {
      throw new Error('boom');
    };
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(0, 0, 10, 10).endFill();
    root.addChild(g);

    await expect(exportToPDF(mock.ck, root, 100, 100)).rejects.toThrow('boom');
    expect(mock.docs).toHaveLength(1);
    expect(mock.docs[0]._closeCalled).toBe(1);
    // The document is freed even when rendering throws.
    expect(mock.docs[0]._deleteCalled).toBe(1);
  });

  it('throws PDFExportFailedError and frees the doc when beginPage returns null', async () => {
    const mock = makeMockPDFCanvasKit(undefined, { beginPageReturnsNull: true });
    const root = new Container();

    await expect(exportToPDF(mock.ck, root, 100, 100)).rejects.toBeInstanceOf(
      PDFExportFailedError,
    );
    expect(mock.docs).toHaveLength(1);
    expect(mock.docs[0]._closeCalled).toBe(1);
    expect(mock.docs[0]._deleteCalled).toBe(1);
  });

  it('throws PDFExportFailedError and frees the doc when getOutput is empty', async () => {
    const mock = makeMockPDFCanvasKit(() => new Uint8Array(0));
    const root = new Container();

    await expect(exportToPDF(mock.ck, root, 100, 100)).rejects.toBeInstanceOf(
      PDFExportFailedError,
    );
    expect(mock.docs).toHaveLength(1);
    expect(mock.docs[0]._deleteCalled).toBe(1);
  });
});

describe('exportToPDF — output size signal', () => {
  it('passes through arbitrarily-sized byte buffers', async () => {
    const big = new Uint8Array(2048);
    big.set(new TextEncoder().encode('%PDF-'), 0);
    const mock = makeMockPDFCanvasKit(() => big);

    const blob = await exportToPDF(mock.ck, new Container(), 100, 100);
    expect(blob.size).toBe(2048);
  });
});

describe('exportToPDF — integration smoke (real CanvasKit)', () => {
  let realCK: CanvasKit | null = null;

  beforeEach(async () => {
    try {
      // NOTE: this imports the `canvaskit-wasm` npm package, which never ships
      // the PDF binding — so the `%PDF-` branch below is unreachable here and
      // this is only a guard-path smoke test. The patched binding lives in the
      // project's `public/canvaskit/` artifact (loaded by the app, not by this
      // import); exercising it is the manual Post-Completion check in the plan.
      // In jsdom the node binding loads via Buffer-backed fetch; if that fails
      // we skip.
      const mod = (await import('canvaskit-wasm')) as unknown as {
        default: (opts?: { locateFile?: (f: string) => string }) => Promise<CanvasKit>;
      };
      realCK = await mod.default({});
    } catch {
      realCK = null;
    }
  });

  afterEach(() => {
    realCK = null;
  });

  it('produces a %PDF- blob OR skips when the bundled build has no PDF backend', async () => {
    if (!realCK) {
      // CanvasKit couldn't initialize in this environment (jsdom + WASM).
      // That's expected for unit-test CI; the build-step rebuilds canvaskit
      // with PDF enabled and a manual visual check covers the real pipeline.
      return;
    }
    if (!hasPDFSupport(realCK)) {
      // Stock canvaskit-wasm@0.41.x ships without skia_enable_pdf=true. The
      // plan's Plan B documents this; rerun after `npm run build:canvaskit`.
      await expect(
        exportToPDF(realCK, new Container(), 100, 100),
      ).rejects.toBeInstanceOf(PDFExportNotSupportedError);
      return;
    }

    const root = new Container();
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(10, 10, 80, 80).endFill();
    root.addChild(g);

    const blob = await exportToPDF(realCK, root, 200, 200, {
      metadata: { title: 'sboard smoke' },
    });
    const buf = new Uint8Array(await blob.arrayBuffer());
    const head = new TextDecoder().decode(buf.slice(0, 5));
    expect(head).toBe('%PDF-');
    expect(buf.byteLength).toBeGreaterThan(1024);
  });
});
