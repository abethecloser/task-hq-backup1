import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone web build (browser localStorage): the Quest app plus the compact
// popup page for preview. The Chrome extension build is vite.extension.config.ts.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    modulePreload: false,
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), popup: resolve(__dirname, 'popup.html') } },
  },
});
