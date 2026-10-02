import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Only vendor libraries that the entry never needs eagerly get named chunks.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[\/](react|react-dom|react-router|scheduler)[\/]/.test(id)) return 'react';
          if (/node_modules[\/](recharts|recharts-scale|victory-vendor|d3-[^\/]+|internmap|decimal\.js-light|es-toolkit|immer|reselect|redux|@reduxjs[\/]toolkit|react-redux|use-sync-external-store|eventemitter3)[\/]/.test(id)) return 'charts';
          // Shared by the shell and charts; a named chunk keeps it out of `charts`.
          if (/node_modules[\/](clsx|tailwind-merge)[\/]/.test(id)) return 'utils';
          if (/node_modules[\/]lucide-react[\/]/.test(id)) return 'icons';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
});
