import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.env['LOTAGATE_BUILD_PLATFORM']?.trim();
const architecture = process.env['LOTAGATE_BUILD_ARCH']?.trim();
const args = ['scripts/prepare-speech-runtime.mjs'];
const forwardedArguments = process.argv.slice(2);

if (forwardedArguments.length > 0) {
  args.push(...forwardedArguments);
} else if (platform !== undefined || architecture !== undefined) {
  if (platform === undefined || architecture === undefined) throw new Error('LOTAGATE_BUILD_PLATFORM and LOTAGATE_BUILD_ARCH must be configured together.');
  args.push('--platform', platform, '--arch', architecture);
}

await run(process.execPath, args);

function run(command, commandArgs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { cwd: desktopRoot, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Speech runtime preparation failed with exit code ${String(code)}.`)));
  });
}
