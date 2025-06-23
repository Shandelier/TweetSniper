import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'popup/popup') {
            return 'popup/popup.js';
          }
          return '[name].js';
        },
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.html')) {
            return 'popup/[name].[ext]';
          }
          return '[name].[ext]';
        },
      },
    },
    sourcemap: false,
    minify: false, // Keep readable for development
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [
    {
      name: 'copy-assets',
      generateBundle() {
        // Copy manifest and icons
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: readFileSync('src/manifest.json'),
        });
        this.emitFile({
          type: 'asset',
          fileName: 'icons/icon128.png',
          source: readFileSync('src/icons/icon128.png'),
        });
        // Copy popup.html to correct location
        this.emitFile({
          type: 'asset',
          fileName: 'popup/popup.html',
          source: readFileSync('src/popup/popup.html'),
        });
      },
    },
  ],
}); 