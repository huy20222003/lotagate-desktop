import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const targets = JSON.parse(await readFile(resolve(scriptRoot, 'release-targets.json'), 'utf8'));
const options = parseOptions(process.argv.slice(2));

if (options.list) {
  for (const target of targets) console.log(`${target.id}: ${target.platform}/${target.architecture} on ${target.runner}`);
  process.exit(0);
}
if (options.githubMatrix) {
  console.log(JSON.stringify(targets));
  process.exit(0);
}

const target = targets.find(candidate => candidate.id === options.target);
if (target === undefined) throw new Error(`Unknown target '${options.target}'. Use --list to see supported targets.`);
const args = ['scripts/build-installers.mjs', '--platform', target.platform, '--arch', target.architecture];
if (options.skipInstall) args.push('--skip-install');
if (options.skipValidation) args.push('--skip-validation');
await run(process.execPath, args);

function parseOptions(args) {
  const parsed = { githubMatrix: false, list: false, skipInstall: false, skipValidation: false, target: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--github-matrix') parsed.githubMatrix = true;
    else if (argument === '--list') parsed.list = true;
    else if (argument === '--skip-install') parsed.skipInstall = true;
    else if (argument === '--skip-validation') parsed.skipValidation = true;
    else if (argument === '--target') parsed.target = requiredValue(args, ++index, argument);
    else throw new Error(`Unknown option '${argument}'. Use --list to see supported targets.`);
  }
  if (!parsed.githubMatrix && !parsed.list && parsed.target === undefined) throw new Error('A target is required. Use --list or --github-matrix for discovery.');
  return parsed;
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`Option '${option}' requires a value.`);
  return value;
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: resolve(scriptRoot, '..'), stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Build target exited with code ${String(code)}.`)));
  });
}
