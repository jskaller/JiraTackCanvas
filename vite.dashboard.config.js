import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  define: {
    // Stamped at build time so the running UI can be identified at a glance.
    __JIRATACK_UI_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
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
