import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Slow end-to-end check that `npm run build` succeeds and writes the expected
// artifacts. Skipped outside CI to keep the local test loop fast.
const SHOULD_RUN = process.env.CI === 'true';
const ROOT = resolve(__dirname, '..');

describe('production build', () => {
  it.skipIf(!SHOULD_RUN)(
    'npm run build succeeds and produces dist/index.html with the configured base',
    () => {
      const result = spawnSync('npm', ['run', 'build'], {
        cwd: ROOT,
        env: { ...process.env, VITE_BASE: '/sboard/' },
        encoding: 'utf8',
      });

      if (result.status !== 0) {
        throw new Error(
          `npm run build failed (status=${String(result.status)})\n` +
            `stdout:\n${result.stdout}\n` +
            `stderr:\n${result.stderr}`,
        );
      }

      const indexPath = resolve(ROOT, 'dist/index.html');
      expect(existsSync(indexPath)).toBe(true);
      const indexHtml = readFileSync(indexPath, 'utf8');
      // Vite rewrites bundled asset URLs with the configured base.
      expect(indexHtml).toMatch(/\/sboard\/assets\//);

      const canvasKitWasm = resolve(ROOT, 'dist/canvaskit/canvaskit.wasm');
      expect(existsSync(canvasKitWasm)).toBe(true);
      // Sanity-check that the WASM artifact was copied wholesale, not truncated.
      expect(statSync(canvasKitWasm).size).toBeGreaterThan(1_000_000);
    },
    180_000,
  );
});
