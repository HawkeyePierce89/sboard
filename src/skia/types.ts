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
 * It is reproduced locally because `@types/canvaskit-wasm@0.41.x` does not
 * declare any PDF surface. The runtime binding is provided by the custom
 * `docker/canvaskit-build` image, which adds `MakePDFDocument` to
 * `canvaskit_bindings.cpp` via `canvaskit-pdf-bindings.patch` (on top of
 * `skia_enable_pdf=true`, which only compiles Skia's C++ PDF backend).
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
  /**
   * Starts a new page and returns its `Canvas`, or `null` if the underlying
   * `SkPDF::MakeDocument` failed to initialize (the patch's `beginPage`
   * returns `nullptr` in that case).
   */
  beginPage(width: number, height: number): Canvas | null;
  endPage(): void;
  close(): void;
  /**
   * Returns the accumulated PDF bytes. Backed by the patch's `JsPDFDocument`,
   * which detaches the stream into an `sk_sp<SkData>` member and returns a
   * `typed_memory_view` over it (a live `Uint8Array`).
   */
  getOutput(): Uint8Array;
  /**
   * Frees the underlying C++ `JsPDFDocument`. It is a raw-pointer Embind
   * object (auto-generated `.delete()`), so JS must call this or the wrapper
   * and its retained output buffer leak in the WASM heap.
   */
  delete(): void;
}

export interface CanvasKitWithPDF extends CanvasKit {
  MakePDFDocument(metadata?: PDFMetadata): PDFDocument;
}
