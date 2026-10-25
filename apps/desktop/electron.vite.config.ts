import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          settings: resolve('src/preload/settings.ts'),
          picker: resolve('src/preload/picker.ts'),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    base: './',
    build: {
      rollupOptions: {
        input: {
          settings: resolve('src/renderer/settings.html'),
          picker: resolve('src/renderer/picker.html'),
        },
      },
    },
  },
});
