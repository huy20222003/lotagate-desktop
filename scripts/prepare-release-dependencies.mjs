import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const nodeModulesRoot = join(desktopRoot, 'node_modules');
const electronRoot = join(nodeModulesRoot, 'electron');

await assertRequiredPackage('electron');
await runNodeScript(join(nodeModulesRoot, '@lotagate', 'cli', 'scripts', 'install-native.mjs'), 'Preparing the target-specific CLI native binary');
await runNodeScript(join(nodeModulesRoot, 'esbuild', 'install.js'), 'Preparing the esbuild runtime');
await runNodeScript(join(nodeModulesRoot, 'node-pty', 'scripts', 'post-install.js'), 'Preparing the node-pty runtime');
if (!(await electronRuntimeIsInstalled())) {
  await runNodeScript(join(electronRoot, 'install.js'), 'Downloading the Electron runtime', {
    ELECTRON_INSTALL_PLATFORM: process.platform,
    ELECTRON_INSTALL_ARCH: process.arch,
  });
}
if (!(await electronRuntimeIsInstalled())) throw new Error(`Electron ${await packageVersion(electronRoot)} is not installed for ${process.platform}/${process.arch}.`);
console.log(`Release dependencies are ready for ${process.platform}/${process.arch}.`);

async function assertRequiredPackage(name) {
  try {
    await access(join(nodeModulesRoot, name, 'package.json'), constants.F_OK);
  } catch {
    throw new Error(`Required package '${name}' is missing after npm ci.`);
  }
}

async function electronRuntimeIsInstalled() {
  try {
    const platformPath = (await readFile(join(electronRoot, 'path.txt'), 'utf8')).trim();
    return platformPath.length > 0 && await fileExists(join(electronRoot, 'dist', platformPath));
  } catch {
    return false;
  }
}

async function packageVersion(packageRoot) {
  try {
    const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    return typeof packageJson.version === 'string' ? packageJson.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function runNodeScript(scriptPath, label, environment = {}) {
  return new Promise((resolvePromise, reject) => {
    console.log(`\n==> ${label}`);
    const child = spawn(process.execPath, [scriptPath], {
      cwd: desktopRoot,
      env: { ...process.env, ...environment },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${label} failed with exit code ${String(code)}.`)));
  });
}
