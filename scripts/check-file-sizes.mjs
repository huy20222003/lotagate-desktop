import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const roots = ['src'];
const executable = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const violations = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (executable.has(extname(entry.name))) {
      const lines = (await readFile(path, 'utf8')).split(/\r?\n/u).length;
      if (lines > 600) violations.push(`${path}: ${lines} lines`);
    }
  }
}

for (const root of roots) await visit(root);
if (violations.length > 0) { console.error(violations.join('\n')); process.exitCode = 1; }
else console.log('Executable source and test files are within the 600-line limit.');
