import { access, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

const execFileAsync = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetsPath = resolve(desktopRoot, 'scripts', 'release-targets.json');
const options = parseOptions(process.argv.slice(2));
const apiBaseUrl = resolveApiBaseUrl();
const repository = options.repository ?? process.env['GITHUB_REPOSITORY'] ?? await readGitHubRepository();
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) fail('Repository must use the OWNER/REPO format.');
const token = await resolveToken();
const run = options.runId === undefined ? await findReleaseRun(repository, options.tag) : await getRun(repository, options.runId);
if (run.status !== 'completed' || run.conclusion !== 'success') fail(`GitHub Actions run ${String(run.id)} is not successful (status=${String(run.status)}, conclusion=${String(run.conclusion)}).`);
const artifacts = await listArtifacts(repository, run.id);
const targetIds = await readTargetIds();
const targetArtifacts = artifacts.filter(artifact => targetIds.includes(artifact.name));
if (targetArtifacts.length !== targetIds.length) {
  const available = targetArtifacts.map(artifact => artifact.name).sort().join(', ') || '(none)';
  fail(`GitHub Actions run ${String(run.id)} is missing release artifacts. Found: ${available}.`);
}
const outputDirectory = resolveOutputDirectory(options.output, run.id);
await mkdir(outputDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'lotagate-release-artifacts-'));
try {
  for (const artifact of targetArtifacts.sort((left, right) => left.name.localeCompare(right.name))) {
    await downloadArtifact(artifact, outputDirectory, temporaryDirectory);
  }
  console.log(`Downloaded ${String(targetArtifacts.length)} Desktop artifacts from GitHub Actions run ${String(run.id)} to ${outputDirectory}.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function parseOptions(args) {
  const parsed = { output: resolve(desktopRoot, 'release-artifacts'), repository: undefined, runId: undefined, tag: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') { printHelp(); process.exit(0); }
    if (argument === '--output') parsed.output = requireValue(args, ++index, argument);
    else if (argument === '--repo') parsed.repository = requireValue(args, ++index, argument);
    else if (argument === '--run-id') parsed.runId = requireValue(args, ++index, argument);
    else if (argument === '--tag') parsed.tag = requireValue(args, ++index, argument);
    else fail(`Unknown option '${argument}'. Use --help for supported options.`);
  }
  if (parsed.runId !== undefined && !/^\d+$/u.test(parsed.runId)) fail('--run-id must be a numeric GitHub Actions run id.');
  if (parsed.tag !== undefined && !/^desktop-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(parsed.tag)) fail('--tag must be a desktop-vX.Y.Z release tag.');
  if (parsed.runId !== undefined && parsed.tag !== undefined) fail('Use either --run-id or --tag, not both.');
  return parsed;
}

function printHelp() {
  console.log('Usage: npm run artifacts:download -- [--run-id ID | --tag desktop-vX.Y.Z] [--repo OWNER/REPO] [--output DIRECTORY]');
  console.log('Authentication: set GITHUB_TOKEN/GH_TOKEN, or authenticate GitHub CLI with gh auth login.');
}

function requireValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) fail(`Option '${option}' requires a value.`);
  return value;
}

function resolveApiBaseUrl() {
  const value = process.env['GITHUB_API_URL'] ?? 'https://api.github.com';
  const url = new URL(value);
  if (url.protocol !== 'https:') fail('GITHUB_API_URL must use HTTPS.');
  return url.toString().replace(/\/$/u, '');
}

async function resolveToken() {
  const environmentToken = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  if (environmentToken?.trim()) return environmentToken.trim();
  try {
    const result = await execFileAsync('gh', ['auth', 'token'], { timeout: 5_000, windowsHide: true, maxBuffer: 16 * 1024 });
    const cliToken = String(result.stdout).trim();
    if (cliToken) return cliToken;
  } catch { /* Fall through to the actionable error below. */ }
  fail('A GitHub token is required. Set GITHUB_TOKEN/GH_TOKEN or run gh auth login.');
}

async function readGitHubRepository() {
  try {
    const result = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd: desktopRoot, timeout: 5_000, windowsHide: true, maxBuffer: 16 * 1024 });
    const remote = String(result.stdout).trim();
    const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/iu.exec(remote);
    if (match?.[1]) return match[1];
  } catch { /* Fall through to the actionable error below. */ }
  fail('Unable to determine the GitHub repository. Provide --repo OWNER/REPO.');
}

async function findReleaseRun(repositoryName, tag) {
  const runs = await fetchJson(`/repos/${repositoryName}/actions/runs?event=push&per_page=100`);
  const candidates = Array.isArray(runs.workflow_runs) ? runs.workflow_runs : [];
  const matching = candidates.find(run => run.path?.endsWith('/desktop-release.yml') && run.status === 'completed' && run.conclusion === 'success' && (tag === undefined || run.head_branch === tag || run.display_title === tag));
  if (matching === undefined) fail(`No Desktop release workflow run was found${tag === undefined ? '' : ` for tag ${tag}`}.`);
  return matching;
}

async function getRun(repositoryName, runId) {
  return fetchJson(`/repos/${repositoryName}/actions/runs/${runId}`);
}

async function listArtifacts(repositoryName, runId) {
  const artifacts = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetchJson(`/repos/${repositoryName}/actions/runs/${runId}/artifacts?per_page=100&page=${String(page)}`);
    if (Array.isArray(response.artifacts)) artifacts.push(...response.artifacts);
    if (!Array.isArray(response.artifacts) || response.artifacts.length < 100) break;
  }
  return artifacts.filter(artifact => artifact.expired !== true && typeof artifact.name === 'string' && typeof artifact.archive_download_url === 'string');
}

async function readTargetIds() {
  const targets = JSON.parse(await readFile(targetsPath, 'utf8'));
  if (!Array.isArray(targets) || targets.length === 0 || targets.some(target => typeof target?.id !== 'string')) fail('The release target manifest is invalid.');
  return targets.map(target => `desktop-${target.id}`);
}

function resolveOutputDirectory(value, runId) {
  const candidate = resolve(desktopRoot, value ?? `release-artifacts-${runId}`);
  if (isAbsolute(value ?? '') && candidate === resolve(homedir())) fail('Refusing to use the user home directory as the artifact output directory.');
  return candidate;
}

async function downloadArtifact(artifact, outputDirectory, temporaryDirectory) {
  const targetName = artifact.name;
  if (!/^desktop-(?:win32|darwin|linux)-(?:x64|arm64)$/u.test(targetName)) return;
  const archivePath = join(temporaryDirectory, `${targetName}.zip`);
  const extractionPath = join(temporaryDirectory, targetName);
  const finalPath = join(outputDirectory, targetName);
  await downloadFile(artifact.archive_download_url, archivePath);
  await validateArchive(archivePath);
  await mkdir(extractionPath, { recursive: true });
  await extractArchive(archivePath, extractionPath);
  await validateReleaseManifest(extractionPath, targetName);
  if (await pathExists(finalPath)) fail(`Artifact output already exists: ${finalPath}. Choose a new --output directory.`);
  await rename(extractionPath, finalPath);
  console.log(`- ${targetName} -> ${finalPath}`);
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok || response.body === null) fail(`Unable to download GitHub artifact (${response.status} ${response.statusText}).`);
  await pipeline(response.body, createWriteStream(destination, { flags: 'wx' }));
}

async function validateArchive(archivePath) {
  const result = await execFileAsync('tar', ['-tf', archivePath], { timeout: 30_000, windowsHide: true, maxBuffer: 256 * 1024 });
  for (const entry of String(result.stdout).split(/\r?\n/u).map(value => value.trim()).filter(Boolean)) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) fail(`GitHub artifact contains an unsafe archive path: ${entry}`);
  }
}

async function extractArchive(archivePath, destination) {
  await execFileAsync('tar', ['-xf', archivePath, '-C', destination], { timeout: 120_000, windowsHide: true, maxBuffer: 256 * 1024 });
}

async function validateReleaseManifest(directory, targetName) {
  const manifestPath = join(directory, 'release-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== 1 || manifest.target?.id !== targetName.slice('desktop-'.length) || !Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) fail(`Artifact ${targetName} has an invalid release manifest.`);
}

async function fetchJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, { headers: githubHeaders() });
  const text = await response.text();
  if (!response.ok) fail(`GitHub API request failed (${response.status}): ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { fail('GitHub API returned invalid JSON.'); }
}

function githubHeaders() {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'lotagate-desktop-release-downloader' };
}

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

function fail(message) { console.error(message); process.exit(1); }
