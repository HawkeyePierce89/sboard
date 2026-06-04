import type {
  Canvas,
  CanvasKit,
  Image,
  Paint,
  Path,
  Surface,
} from 'canvaskit-wasm';

export type { Canvas, Image, Paint, Path, Surface };

/**
 * PDF metadata accepted by the Skia PDF backend.
 *
 * The shape mirrors `SkPDF::Metadata` (see
 * https://skia.googlesource.com/skia/+/refs/heads/main/include/docs/SkPDFDocument.h).
 * It is reproduced locally because `@types/canvaskit-wasm@0.41.x` does
 * not declare any PDF surface — those bindings only exist in the
 * `skia_enable_pdf=true` custom build (see docker/canvaskit-build).
 */
export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
}

export interface PDFDocument {
  beginPage(width: number, height: number): Canvas;
  endPage(): void;
  close(): void;
  /**
   * Returns the bytes accumulated so far. The exact name on the JS
   * binding is confirmed empirically in Task 8 and adjusted here.
   */
  getOutput(): Uint8Array;
}

export interface CanvasKitWithPDF extends CanvasKit {
  MakePDFDocument(metadata?: PDFMetadata): PDFDocument;
}
