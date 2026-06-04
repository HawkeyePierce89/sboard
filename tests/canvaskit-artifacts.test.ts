import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC_CANVASKIT = resolve(__dirname, '..', 'public', 'canvaskit');
const JS_PATH = resolve(PUBLIC_CANVASKIT, 'canvaskit.js');
const WASM_PATH = resolve(PUBLIC_CANVASKIT, 'canvaskit.wasm');

describe('canvaskit artifacts', () => {
  it('public/canvaskit/canvaskit.js exists', () => {
    expect(existsSync(JS_PATH)).toBe(true);
  });

  it('public/canvaskit/canvaskit.wasm exists', () => {
    expect(existsSync(WASM_PATH)).toBe(true);
  });

  it('canvaskit.wasm is at least 1 MB', () => {
    const size = statSync(WASM_PATH).size;
    expect(size).toBeGreaterThan(1024 * 1024);
  });

  it('canvaskit.wasm starts with the WASM magic bytes (\\0asm)', () => {
    const fd = readFileSync(WASM_PATH);
    expect(fd.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
  });

  it('canvaskit.js exposes a CanvasKitInit entry point', () => {
    const js = readFileSync(JS_PATH, 'utf8');
    expect(js).toMatch(/CanvasKitInit/);
  });
});
