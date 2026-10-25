// @ts-check
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  devToolbar: { enabled: false },
  server: { host: true, port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: false,
        },
        '/ws': {
          target: 'ws://127.0.0.1:8000',
          ws: true,
          changeOrigin: false,
        },
      },
    },
  },
});
