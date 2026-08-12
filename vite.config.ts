import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* Il client viene compilato in dist/client e poi INCORPORATO nel bundle del
 * server (scripts/embed-assets.mjs), quindi l'eseguibile finale e' un file
 * unico senza directory di asset da copiare sul PBX. */
export default defineConfig({
  root: 'client',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 8192,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
});
