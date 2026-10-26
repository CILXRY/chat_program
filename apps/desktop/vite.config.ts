import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = resolve(process.cwd(), 'ui');

export default defineConfig({
  root,
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: resolve(process.cwd(), 'dist-ui'),
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      input: {
        settings: resolve(root, 'settings.html'),
      },
    },
  },
});
