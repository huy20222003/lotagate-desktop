import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./.vite/renderer/main_window', import.meta.url)),
    emptyOutDir: true,
  },
});
