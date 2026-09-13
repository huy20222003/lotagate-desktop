import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputDirectory = resolve(desktopRoot, 'resources', 'sandbox');
const entry = resolve(desktopRoot, 'src', 'main', 'sandbox', 'guest-document-entry.ts');
const builtins = new Set(builtinModules.flatMap(value => [value, `node:${value}`]));

await build({
  configFile: false,
  root: desktopRoot,
  build: {
    emptyOutDir: false,
    outDir: outputDirectory,
    lib: { entry, formats: ['es'], fileName: () => 'document-runner.mjs' },
    rollupOptions: { external: id => builtins.has(id) },
    sourcemap: false,
    minify: 'terser',
  },
  logLevel: 'warn',
});

console.log('Prepared the VM document runner.');
