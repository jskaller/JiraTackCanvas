import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/bookmarklet',
    emptyOutDir: true,
    lib: {
      entry: 'src/bookmarklet/index.js',
      formats: ['iife'],
      name: 'JiraTackBookmarklet',
      fileName: 'bookmarklet',
    },
  },
});
