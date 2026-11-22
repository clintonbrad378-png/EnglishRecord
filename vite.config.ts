import { defineConfig } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH || '/',
  server: {
    headers: isolationHeaders,
    strictPort: true,
    port: 5173,
  },
  preview: {
    headers: isolationHeaders,
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
  },
  worker: {
    format: 'es',
  },
  define: {
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  esbuild: command === 'serve' ? {} : { legalComments: 'none' },
}));
