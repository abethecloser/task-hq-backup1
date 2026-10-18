// Builds the installable Quest Chrome extension into ./extension
// (Chrome → Extensions → Developer mode → Load unpacked → choose that folder).
// It contains the full Quest app (index.html), the popup and the background worker,
// all sharing chrome.storage through src/adapter/store.ts.
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'quest-manifest',
      writeBundle() { copyFileSync(resolve(__dirname, 'extension-static/manifest.json'), resolve(__dirname, 'extension/manifest.json')); },
    },
  ],
  build: {
    outDir: 'extension',
    emptyOutDir: true,
    modulePreload: false,
    target: 'chrome120',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/extension/background.ts'),
      },
      output: {
        entryFileNames: chunk => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
