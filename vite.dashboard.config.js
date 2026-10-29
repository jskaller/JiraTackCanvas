import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  root: 'src/custom-ui/dashboard',
  resolve: {
    alias: {
      '@shared': path.resolve(dirname, 'src/shared'),
    },
  },
  build: {
    outDir: '../../../dist/dashboard',
    emptyOutDir: true,
  },
});
