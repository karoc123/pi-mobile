import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3000',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist/public',
    emptyOutDir: true
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
});