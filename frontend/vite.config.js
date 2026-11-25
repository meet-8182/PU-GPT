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
    allowedHosts: ['https://alike-with-accomplished-accidents.trycloudflare.com/', 'localhost', '.trycloudflare.com'],
    // Only the local dev app may make cross-origin requests to the dev server.
    cors: {
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173','https://alike-with-accomplished-accidents.trycloudflare.com/'],
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
    proxy: {
      '/api': {
        // Use 127.0.0.1 (IPv4) explicitly. On Windows "localhost" resolves to
        // ::1 first, where a Playwright MCP server can occupy port 3001 and
        // intercept API requests. The backend binds to 0.0.0.0 (IPv4).
        target: 'http://127.0.0.1:3001',
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

