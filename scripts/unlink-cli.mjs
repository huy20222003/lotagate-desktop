import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(desktopRoot, 'package.json'), 'utf8'));
const declaredVersion = manifest.dependencies?.['@lotagate/cli'];
if (typeof declaredVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(declaredVersion)) {
  throw new Error('Desktop must declare @lotagate/cli with an exact semantic version before unlinking.');
}

await runNpm(['unlink', '@lotagate/cli', '--no-save']);
await runNpm(['install', '--save-exact', `@lotagate/cli@${declaredVersion}`]);

function runNpm(args) {
  return new Promise((resolvePromise, reject) => {
    const npmExecPath = process.env.npm_execpath;
    const command = typeof npmExecPath === 'string' && npmExecPath.trim() !== '' ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const commandArgs = command === process.execPath ? [npmExecPath, ...args] : args;
    const child = spawn(command, commandArgs, { cwd: desktopRoot, stdio: 'inherit', shell: command === 'npm.cmd', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`npm ${args.join(' ')} failed with exit code ${String(code)}.`)));
  });
}
