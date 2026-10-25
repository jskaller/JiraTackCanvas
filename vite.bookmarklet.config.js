import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/bookmarklet',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/bookmarklet/index.js',
      output: {
        format: 'iife',
        entryFileNames: 'jiratack.js',
        inlineDynamicImports: true,
      },
    },
  },
});
