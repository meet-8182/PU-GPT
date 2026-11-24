import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
    extensions: ['.js', '.jsx', '.json'],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    // Allow Cloudflare tunnel host for development
    allowedHosts: ['lead-combat-lots-spatial.trycloudflare.com', 'localhost', '.trycloudflare.com'],
    // Only the local dev app may make cross-origin requests to the dev server.
    cors: {
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173','http://lead-combat-lots-spatial.trycloudflare.com'],
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: true,
  },
});

