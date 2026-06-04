import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('loads the main entry module', async () => {
    const mod = await import('../src/main');
    expect(mod.APP_NAME).toBe('sboard');
    expect(typeof mod.bootstrap).toBe('function');
  });

  it('bootstrap sets document.title in a DOM environment', async () => {
    const mod = await import('../src/main');
    mod.bootstrap();
    expect(document.title).toBe('sboard');
  });
});
