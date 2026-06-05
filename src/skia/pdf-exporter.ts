import type { CanvasKit } from 'canvaskit-wasm';
import type { Container } from 'pixi.js';
import { walkContainer } from '../pixi/scene-walker';
import { PixiToSkiaRenderer, type ImageProvider } from './renderer';
import type { CanvasKitWithPDF, PDFDocument, PDFMetadata } from './types';

export interface ExportToPDFOptions {
  metadata?: PDFMetadata;
  imageProvider?: ImageProvider;
}

/**
 * Type-guard: whether the loaded CanvasKit exposes the PDF backend to
 * JavaScript. The custom `docker/canvaskit-build` image defines
 * `MakePDFDocument` via `canvaskit-pdf-bindings.patch` (on top of
 * `skia_enable_pdf=true`); the stock `canvaskit-wasm@0.41.x` package does not.
 * Callers use this to fail fast with a user-visible error — rather than
 * crashing inside CanvasKit — when a stock/unpatched build is loaded.
 */
export function hasPDFSupport(
  canvasKit: CanvasKit,
): canvasKit is CanvasKitWithPDF {
  return (
    typeof (canvasKit as Partial<CanvasKitWithPDF>).MakePDFDocument ===
    'function'
  );
}

export class PDFExportNotSupportedError extends Error {
  constructor() {
    super(
      'CanvasKit build does not expose MakePDFDocument — a stock or ' +
        'unpatched canvaskit.js is loaded. Rebuild with the PDF JS binding ' +
        'via `npm run build:canvaskit` (applies canvaskit-pdf-bindings.patch; ' +
        'see docker/canvaskit-build/README.md). Note: skia_enable_pdf=true ' +
        'alone is not sufficient.',
    );
    this.name = 'PDFExportNotSupportedError';
  }
}

/**
 * Render a Pixi container into a single-page vector PDF and return the
 * resulting bytes as a Blob suitable for `URL.createObjectURL` download.
 *
 * The flow mirrors the Skia C++ contract:
 *   1. `MakePDFDocument(metadata)` allocates a new doc with an internal sink.
 *   2. `beginPage(w, h)` returns an `SkCanvas` for the current page.
 *   3. We walk the Pixi tree → `SkiaSceneNode`, then replay through
 *      `PixiToSkiaRenderer` exactly like the on-screen Skia canvas — so
 *      the PDF stays vector (no rasterized surface in between).
 *   4. `endPage()` finalizes the page, `close()` writes the trailer.
 *   5. `getOutput()` returns the accumulated bytes (`Uint8Array`).
 *
 * If a stock/unpatched CanvasKit (no `MakePDFDocument`) is loaded, this throws
 * `PDFExportNotSupportedError` — the caller (UI export button) should surface
 * that to the user.
 */
export async function exportToPDF(
  canvasKit: CanvasKit,
  container: Container,
  width: number,
  height: number,
  options: ExportToPDFOptions = {},
): Promise<Blob> {
  if (!hasPDFSupport(canvasKit)) {
    throw new PDFExportNotSupportedError();
  }

  const doc: PDFDocument = canvasKit.MakePDFDocument(options.metadata);
  const renderer = new PixiToSkiaRenderer(canvasKit, options.imageProvider);
  const sceneNode = walkContainer(container);

  try {
    const pageCanvas = doc.beginPage(width, height);
    renderer.render(pageCanvas, sceneNode);
    doc.endPage();
  } finally {
    doc.close();
  }

  const bytes = doc.getOutput();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
