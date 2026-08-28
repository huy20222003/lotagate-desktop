import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliRoot = resolve(desktopRoot, '..', 'cli');

await assertCliPackage();
await runNpm(cliRoot, ['run', 'build']);
await runNpm(cliRoot, ['link']);
await runNpm(desktopRoot, ['link', '@lotagate/cli']);

async function assertCliPackage() {
  const manifest = JSON.parse(await readFile(resolve(cliRoot, 'package.json'), 'utf8'));
  if (manifest.name !== '@lotagate/cli') throw new Error(`Expected ${cliRoot} to contain @lotagate/cli.`);
}

function runNpm(cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const npmExecPath = process.env.npm_execpath;
    const command = typeof npmExecPath === 'string' && npmExecPath.trim() !== '' ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const commandArgs = command === process.execPath ? [npmExecPath, ...args] : args;
    const child = spawn(command, commandArgs, { cwd, stdio: 'inherit', shell: command === 'npm.cmd', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`npm ${args.join(' ')} failed with exit code ${String(code)}.`)));
  });
}
