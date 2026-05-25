import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import type { CanvasKit } from 'canvaskit-wasm';
import {
  defaultTriggerDownload,
  formatExportError,
  wireExportButton,
  type ExportFn,
} from '../../src/ui/export-button';
import { PDFExportNotSupportedError } from '../../src/skia/pdf-exporter';

function setupDom(buttonId = 'btn-export-pdf'): HTMLButtonElement {
  document.body.innerHTML = '';
  const b = document.createElement('button');
  b.id = buttonId;
  b.textContent = 'Export to PDF';
  document.body.appendChild(b);
  return b;
}

function fakeCanvasKit(): CanvasKit {
  return {} as CanvasKit;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('wireExportButton — happy path', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('calls exportToPDF with the current scene and dimensions on click', async () => {
    const button = setupDom();
    const scene = new Container();
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    const exportFn = vi.fn<ExportFn>().mockResolvedValue(blob);
    const triggerDownload = vi.fn();
    const ck = fakeCanvasKit();

    wireExportButton(
      { canvasKit: ck, scene: () => scene, width: 500, height: 400 },
      { exportFn, triggerDownload },
    );
    button.click();
    await flushMicrotasks();

    expect(exportFn).toHaveBeenCalledTimes(1);
    expect(exportFn).toHaveBeenCalledWith(ck, scene, 500, 400, undefined);
  });

  it('forwards the imageProvider into the exportToPDF options when configured', async () => {
    const button = setupDom();
    const scene = new Container();
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    const exportFn = vi.fn<ExportFn>().mockResolvedValue(blob);
    const triggerDownload = vi.fn();
    const imageProvider = vi.fn(() => null);

    wireExportButton(
      {
        canvasKit: fakeCanvasKit(),
        scene: () => scene,
        width: 10,
        height: 10,
        imageProvider,
      },
      { exportFn, triggerDownload },
    );
    button.click();
    await flushMicrotasks();

    expect(exportFn).toHaveBeenCalledTimes(1);
    expect(exportFn.mock.calls[0][4]).toEqual({ imageProvider });
  });

  it('passes the resulting Blob and default filename "scene.pdf" to triggerDownload', async () => {
    const button = setupDom();
    const blob = new Blob(['%PDF-x'], { type: 'application/pdf' });
    const exportFn = vi.fn<ExportFn>().mockResolvedValue(blob);
    const triggerDownload = vi.fn();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => new Container(), width: 1, height: 1 },
      { exportFn, triggerDownload },
    );
    button.click();
    await flushMicrotasks();

    expect(triggerDownload).toHaveBeenCalledTimes(1);
    expect(triggerDownload).toHaveBeenCalledWith(blob, 'scene.pdf');
  });

  it('honors a custom filename', async () => {
    const button = setupDom();
    const exportFn = vi
      .fn<ExportFn>()
      .mockResolvedValue(new Blob([], { type: 'application/pdf' }));
    const triggerDownload = vi.fn();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => new Container(), width: 1, height: 1 },
      { exportFn, triggerDownload, fileName: 'diagram.pdf' },
    );
    button.click();
    await flushMicrotasks();

    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), 'diagram.pdf');
  });

  it('re-evaluates the scene callback on every click (latest scene wins)', async () => {
    const button = setupDom();
    const sceneA = new Container();
    const sceneB = new Container();
    let current = sceneA;
    const exportFn = vi
      .fn<ExportFn>()
      .mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }));
    const triggerDownload = vi.fn();

    wireExportButton(
      {
        canvasKit: fakeCanvasKit(),
        scene: () => current,
        width: 100,
        height: 100,
      },
      { exportFn, triggerDownload },
    );

    button.click();
    await flushMicrotasks();
    current = sceneB;
    button.click();
    await flushMicrotasks();

    expect(exportFn).toHaveBeenCalledTimes(2);
    expect(exportFn.mock.calls[0][1]).toBe(sceneA);
    expect(exportFn.mock.calls[1][1]).toBe(sceneB);
  });
});

describe('wireExportButton — UI feedback during export', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('disables the button while the export is pending', async () => {
    const button = setupDom();
    let release!: (b: Blob) => void;
    const exportFn = vi.fn<ExportFn>().mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          release = resolve;
        }),
    );
    const triggerDownload = vi.fn();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => new Container(), width: 1, height: 1 },
      { exportFn, triggerDownload },
    );

    expect(button.disabled).toBe(false);
    button.click();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Generating…');

    release(new Blob(['%PDF-'], { type: 'application/pdf' }));
    await flushMicrotasks();

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Export to PDF');
  });

  it('emits a "Generating PDF…" status on click and a ready status on success', async () => {
    const button = setupDom();
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    const exportFn = vi.fn<ExportFn>().mockResolvedValue(blob);
    const triggerDownload = vi.fn();
    const onStatus = vi.fn<(text: string) => void>();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => new Container(), width: 1, height: 1 },
      { exportFn, triggerDownload, onStatus },
    );
    button.click();
    expect(onStatus).toHaveBeenNthCalledWith(1, 'Generating PDF…');

    await flushMicrotasks();
    expect(onStatus).toHaveBeenLastCalledWith('PDF ready — scene.pdf');
    expect(onStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores re-entrant clicks while an export is in flight', async () => {
    const button = setupDom();
    let release!: (b: Blob) => void;
    const exportFn = vi.fn<ExportFn>().mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          release = resolve;
        }),
    );
    const triggerDownload = vi.fn();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => new Container(), width: 1, height: 1 },
      { exportFn, triggerDownload },
    );

    button.click();
    button.click(); // second click while pending — should be ignored
    button.click();

    expect(exportFn).toHaveBeenCalledTimes(1);

    release(new Blob([], { type: 'application/pdf' }));
    await flushMicrotasks();
  });
});

describe('wireExportButton — error handling', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('surfaces a generic Error.message via onStatus and restores the button', async () => {
    const button = setupDom();
    const exportFn = vi
      .fn<ExportFn>()
      .mockRejectedValue(new Error('renderer blew up'));
    const triggerDownload = vi.fn();
    const onStatus = vi.fn<(text: string) => void>();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => new Container(), width: 1, height: 1 },
      { exportFn, triggerDownload, onStatus },
    );
    button.click();
    await flushMicrotasks();

    expect(triggerDownload).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('PDF export failed: renderer blew up');
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Export to PDF');
  });

  it('produces a dedicated message for PDFExportNotSupportedError', async () => {
    const button = setupDom();
    const exportFn = vi
      .fn<ExportFn>()
      .mockRejectedValue(new PDFExportNotSupportedError());
    const onStatus = vi.fn<(text: string) => void>();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => new Container(), width: 1, height: 1 },
      { exportFn, triggerDownload: vi.fn(), onStatus },
    );
    button.click();
    await flushMicrotasks();

    expect(onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('PDF export unavailable:'),
    );
  });

  it('handles non-Error rejections without crashing the UI', async () => {
    const button = setupDom();
    const exportFn = vi.fn<ExportFn>().mockRejectedValue('just a string');
    const onStatus = vi.fn<(text: string) => void>();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => new Container(), width: 1, height: 1 },
      { exportFn, triggerDownload: vi.fn(), onStatus },
    );
    button.click();
    await flushMicrotasks();

    expect(onStatus).toHaveBeenLastCalledWith('PDF export failed');
    expect(button.disabled).toBe(false);
  });
});

describe('wireExportButton — graceful degradation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('no-ops when the button is absent from the DOM', () => {
    const exportFn = vi.fn<ExportFn>();
    expect(() =>
      wireExportButton(
        {
          canvasKit: fakeCanvasKit(),
          scene: () => new Container(),
          width: 1,
          height: 1,
        },
        { exportFn },
      ),
    ).not.toThrow();
    expect(exportFn).not.toHaveBeenCalled();
  });

  it('honors a custom buttonId', async () => {
    const button = setupDom('my-export-btn');
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    const exportFn = vi.fn<ExportFn>().mockResolvedValue(blob);
    const triggerDownload = vi.fn();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => new Container(), width: 1, height: 1 },
      { exportFn, triggerDownload, buttonId: 'my-export-btn' },
    );
    button.click();
    await flushMicrotasks();

    expect(exportFn).toHaveBeenCalledTimes(1);
    expect(triggerDownload).toHaveBeenCalledTimes(1);
  });

  it('still works with a scene containing real Graphics (integration sanity)', async () => {
    const button = setupDom();
    const scene = new Container();
    const g = new Graphics();
    g.beginFill(0xff0000, 1).drawRect(0, 0, 10, 10).endFill();
    scene.addChild(g);

    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    const exportFn = vi.fn<ExportFn>().mockResolvedValue(blob);
    const triggerDownload = vi.fn();

    wireExportButton(
      { canvasKit: fakeCanvasKit(), scene: () => scene, width: 100, height: 100 },
      { exportFn, triggerDownload },
    );
    button.click();
    await flushMicrotasks();

    expect(exportFn).toHaveBeenCalledWith(
      expect.anything(),
      scene,
      100,
      100,
      undefined,
    );
    expect(triggerDownload).toHaveBeenCalledWith(blob, 'scene.pdf');
  });
});

describe('formatExportError', () => {
  it('formats PDFExportNotSupportedError with the prefix', () => {
    const text = formatExportError(new PDFExportNotSupportedError());
    expect(text).toMatch(/^PDF export unavailable:/);
  });

  it('formats a generic Error with its message', () => {
    expect(formatExportError(new Error('boom'))).toBe('PDF export failed: boom');
  });

  it('produces a stable fallback for non-Error values', () => {
    expect(formatExportError('whoops')).toBe('PDF export failed');
    expect(formatExportError(null)).toBe('PDF export failed');
    expect(formatExportError({})).toBe('PDF export failed');
  });
});

describe('defaultTriggerDownload (jsdom DOM integration)', () => {
  let createSpy: ReturnType<typeof vi.spyOn>;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom may or may not implement URL.createObjectURL — stub it so the
    // test is deterministic regardless of the host version.
    if (typeof URL.createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL =
        (): string => 'blob:fake';
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL =
        (): void => {};
    }
    createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it('creates an anchor with download=fileName, clicks it, and revokes the URL', async () => {
    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    defaultTriggerDownload(blob, 'mine.pdf');

    expect(createSpy).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // anchor is removed immediately
    expect(document.querySelector('a[download]')).toBeNull();
    // revoke is deferred to the next tick so the browser has time to
    // start the download before the URL is released.
    expect(revokeSpy).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(revokeSpy).toHaveBeenCalledWith('blob:stub');

    clickSpy.mockRestore();
  });

  it('sets the download attribute and href on the anchor', () => {
    const blob = new Blob(['x'], { type: 'application/pdf' });
    let captured: HTMLAnchorElement | null = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        captured = this;
      });

    defaultTriggerDownload(blob, 'scene.pdf');

    expect(captured).not.toBeNull();
    const a = captured as unknown as HTMLAnchorElement;
    expect(a.download).toBe('scene.pdf');
    expect(a.href).toContain('blob:stub');

    clickSpy.mockRestore();
  });
});
