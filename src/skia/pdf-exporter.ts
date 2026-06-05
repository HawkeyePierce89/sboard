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
 * Type-guard: no CanvasKit build in this repo currently exposes the PDF
 * backend to JavaScript. Neither the stock `canvaskit-wasm@0.41.x` package
 * nor the custom `docker/canvaskit-build` image (compiled with
 * `skia_enable_pdf=true`) defines `MakePDFDocument` — that flag only builds
 * Skia's C++ `SkPDF::MakeDocument`; the JS binding must still be added to
 * `canvaskit_bindings.cpp` and the module rebuilt. Callers use this to fail
 * fast with a user-visible error rather than crashing inside CanvasKit.
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
      'CanvasKit build does not expose MakePDFDocument — the JS PDF binding ' +
        'must be added to canvaskit_bindings.cpp and CanvasKit rebuilt ' +
        '(see docker/canvaskit-build/README.md). Note: skia_enable_pdf=true ' +
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
 * Until the JS PDF binding is added to `canvaskit_bindings.cpp`, this rejects
 * with `PDFExportNotSupportedError` — the caller (UI export button) should
 * surface that to the user.
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
