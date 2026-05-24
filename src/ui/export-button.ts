import type { CanvasKit } from 'canvaskit-wasm';
import type { Container } from 'pixi.js';
import {
  exportToPDF,
  PDFExportNotSupportedError,
  type ExportToPDFOptions,
} from '../skia/pdf-exporter';
import { DomLookupError, getButtonById } from './dom';

export type ExportFn = (
  canvasKit: CanvasKit,
  container: Container,
  width: number,
  height: number,
  options?: ExportToPDFOptions,
) => Promise<Blob>;

export type DownloadTrigger = (blob: Blob, fileName: string) => void;

export interface ExportButtonDeps {
  canvasKit: CanvasKit;
  /**
   * Resolves the scene to export. Re-evaluated on every click so any
   * shapes added between exports (e.g. via the "Generate random shape"
   * button from Task 13) are included.
   */
  scene: () => Container;
  width: number;
  height: number;
}

export interface ExportButtonOptions {
  buttonId?: string;
  fileName?: string;
  onStatus?: (text: string) => void;
  /** Override for unit tests; defaults to the real `exportToPDF`. */
  exportFn?: ExportFn;
  /** Override for unit tests; defaults to a real anchor-based download. */
  triggerDownload?: DownloadTrigger;
}

/**
 * Wire the "Export to PDF" button. The handler:
 *   - disables the button + swaps its label to "Generating…" so the
 *     user gets immediate feedback (Skia PDF export can take a moment)
 *   - calls `exportToPDF(currentScene)` to get a PDF Blob
 *   - downloads the Blob via a synthetic anchor click
 *   - restores the button state in `finally` so a failed export does
 *     not leave the UI stuck
 *
 * No-ops (no error) when the button is absent — keeps the smoke test
 * happy and lets the page render even if the markup is missing.
 */
export function wireExportButton(
  deps: ExportButtonDeps,
  options: ExportButtonOptions = {},
): void {
  let button: HTMLButtonElement;
  try {
    button = getButtonById(options.buttonId ?? 'btn-export-pdf');
  } catch (err) {
    if (err instanceof DomLookupError) return;
    throw err;
  }

  const exportFn = options.exportFn ?? exportToPDF;
  const triggerDownload = options.triggerDownload ?? defaultTriggerDownload;
  const fileName = options.fileName ?? 'scene.pdf';
  const onStatus = options.onStatus;
  const originalLabel = button.textContent ?? 'Export to PDF';

  button.addEventListener('click', () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Generating…';
    onStatus?.('Generating PDF…');

    void runExport({
      exportFn,
      triggerDownload,
      fileName,
      onStatus,
      deps,
    }).finally(() => {
      button.disabled = false;
      button.textContent = originalLabel;
    });
  });
}

interface RunExportArgs {
  exportFn: ExportFn;
  triggerDownload: DownloadTrigger;
  fileName: string;
  onStatus: ((text: string) => void) | undefined;
  deps: ExportButtonDeps;
}

async function runExport(args: RunExportArgs): Promise<void> {
  const { exportFn, triggerDownload, fileName, onStatus, deps } = args;
  try {
    const blob = await exportFn(
      deps.canvasKit,
      deps.scene(),
      deps.width,
      deps.height,
    );
    triggerDownload(blob, fileName);
    onStatus?.(`PDF ready — ${fileName}`);
  } catch (err) {
    onStatus?.(formatExportError(err));
  }
}

export function formatExportError(err: unknown): string {
  if (err instanceof PDFExportNotSupportedError) {
    return `PDF export unavailable: ${err.message}`;
  }
  if (err instanceof Error) {
    return `PDF export failed: ${err.message}`;
  }
  return 'PDF export failed';
}

/**
 * Default download trigger: create an object URL, point a hidden anchor
 * at it, click it, then release the URL on the next tick so the browser
 * has finished kicking off the download before we revoke.
 */
export function defaultTriggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
