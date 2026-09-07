import { access, chmod, copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { WHISPER_CPP_VERSION } from './speech-runtime-constants.mjs';

const execFile = promisify(execFileCallback);
const whisperReleaseCommitPrefix = 'f049fff';
const whisperRepository = 'https://github.com/ggml-org/whisper.cpp.git';
const options = parseOptions(process.argv.slice(2));

if (process.platform !== 'darwin') fail(`Native macOS whisper.cpp builds require macOS; current platform is '${process.platform}'.`);

const output = resolve(options.output);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'lotagate-whisper-cpp-'));
const sourceRoot = join(temporaryRoot, 'source');
const buildRoot = join(temporaryRoot, 'build');

try {
  await run('git', ['clone', '--depth', '1', '--branch', WHISPER_CPP_VERSION, whisperRepository, sourceRoot], 'Cloning whisper.cpp');
  const commit = (await execFile('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'])).stdout.trim();
  if (!commit.startsWith(whisperReleaseCommitPrefix)) fail(`whisper.cpp ${WHISPER_CPP_VERSION} resolved to unexpected commit '${commit}'.`);

  await run('cmake', ['-S', sourceRoot, '-B', buildRoot, '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF'], 'Configuring whisper.cpp');
  await run('cmake', ['--build', buildRoot, '--config', 'Release', '--target', 'whisper-cli', '--parallel'], 'Building whisper-cli');

  const executable = join(buildRoot, 'bin', 'whisper-cli');
  if (!(await isFile(executable))) fail(`The whisper.cpp build did not produce '${executable}'.`);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(executable, output);
  await chmod(output, 0o755);
  console.log(`Built whisper.cpp ${WHISPER_CPP_VERSION} (${commit}) at ${output}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function parseOptions(args) {
  const parsed = { output: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output') parsed.output = requiredValue(args, ++index, argument);
    else if (argument === '--help' || argument === '-h') { printHelp(); process.exit(0); }
    else fail(`Unknown option '${argument}'. Use --help to see supported options.`);
  }
  if (parsed.output === undefined) fail("Option '--output' is required.");
  return parsed;
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) fail(`Option '${option}' requires a value.`);
  return value;
}

async function isFile(path) {
  try { await access(path, constants.X_OK); return (await stat(path)).isFile(); } catch { return false; }
}

function run(command, args, label) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${label} failed with exit code ${String(code)}.`)));
  });
}

function printHelp() { console.log('Usage: node scripts/build-whisper-cpp.mjs --output <path>'); }
function fail(message) { throw new Error(message); }
