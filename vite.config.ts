import { defineConfig } from 'vite';

export default defineConfig(() => ({
  base: process.env.VITE_BASE ?? '/',
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
}));
