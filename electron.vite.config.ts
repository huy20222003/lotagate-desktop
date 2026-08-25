import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url));
const mainEntry = fileURLToPath(new URL('./src/main/index.ts', import.meta.url));
const preloadEntry = fileURLToPath(new URL('./src/preload/bridge.ts', import.meta.url));
const shared = { resolve: { alias: { '@desktop': sourceDirectory } } };

export default defineConfig({
  main: {
    ...shared,
    build: { lib: { entry: mainEntry } },
  },
  preload: {
    ...shared,
    build: { lib: { entry: preloadEntry } },
  },
  renderer: {
    ...shared,
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    plugins: [react()],
  },
});
