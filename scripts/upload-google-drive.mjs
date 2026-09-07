import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const options = parseOptions(process.argv.slice(2));
const token = process.env['GOOGLE_DRIVE_ACCESS_TOKEN']?.trim();
if (!token) throw new Error('GOOGLE_DRIVE_ACCESS_TOKEN is required.');
const parentId = options.parentId ?? process.env['LOTAGATE_DRIVE_PARENT_FOLDER_ID']?.trim();
if (!parentId) throw new Error('Set --parent-id or LOTAGATE_DRIVE_PARENT_FOLDER_ID.');
const root = resolve(options.root);
const version = normalizeVersion(options.version);
const manifests = await findManifests(root);
if (manifests.length === 0) throw new Error(`No release-manifest.json found under ${root}.`);

const desktopReleases = await getOrCreateFolder(parentId, 'desktop-releases');
const versionFolder = await getOrCreateFolder(desktopReleases, version);
const uploaded = [];
for (const manifestPath of manifests) {
  const manifest = await readManifest(manifestPath);
  if (normalizeVersion(manifest.desktopVersion) !== version) throw new Error(`Manifest ${manifestPath} does not match release ${version}.`);
  const platform = drivePlatform(manifest.target?.platform);
  const architecture = requireSegment(manifest.target?.architecture, 'architecture');
  const targetFolder = await getOrCreateFolder(await getOrCreateFolder(versionFolder, platform), architecture);
  const sourceRoot = dirname(manifestPath);
  const files = [{ path: manifestPath, relativePath: 'release-manifest.json', sha256: await hashFile(manifestPath) }];
  for (const artifact of manifest.artifacts ?? []) {
    const relativePath = requireRelativePath(artifact?.file);
    const sourcePath = resolve(sourceRoot, relativePath);
    if (!isInside(sourceRoot, sourcePath) || !(await isRegularFile(sourcePath))) throw new Error(`Manifest references a missing artifact: ${relativePath}.`);
    const actualHash = await hashFile(sourcePath);
    if (actualHash !== artifact.sha256 || (await stat(sourcePath)).size !== artifact.sizeBytes) throw new Error(`Artifact integrity metadata mismatch: ${relativePath}.`);
    files.push({ path: sourcePath, relativePath, sha256: actualHash });
  }
  for (const file of files) {
    const folder = await ensureDrivePath(targetFolder, dirname(file.relativePath));
    const id = await uploadFile(folder, basename(file.relativePath), file.path, file.sha256);
    uploaded.push({ target: manifest.target.id, file: file.relativePath, id, sha256: file.sha256 });
  }
}
console.log(JSON.stringify({ version, files: uploaded }, null, 2));

function parseOptions(args) {
  const parsed = { parentId: undefined, root: '.', version: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--parent-id') parsed.parentId = requiredValue(args, ++index, argument);
    else if (argument === '--root') parsed.root = requiredValue(args, ++index, argument);
    else if (argument === '--version') parsed.version = requiredValue(args, ++index, argument);
    else if (argument === '--help' || argument === '-h') { console.log('Usage: node scripts/upload-google-drive.mjs --root <directory> --version <version> [--parent-id <folder-id>]'); process.exit(0); }
    else throw new Error(`Unknown option '${argument}'.`);
  }
  if (parsed.version === undefined) throw new Error('--version is required.');
  return parsed;
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`Option '${option}' requires a value.`);
  return value;
}

async function readManifest(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (value?.version !== 1 || typeof value.desktopVersion !== 'string' || typeof value.target?.id !== 'string' || !Array.isArray(value.artifacts)) throw new Error(`Invalid release manifest: ${path}.`);
  return value;
}

async function findManifests(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await findManifests(path));
    else if (entry.isFile() && entry.name === 'release-manifest.json') found.push(path);
  }
  return found.sort();
}

async function getOrCreateFolder(parent, name) {
  const existing = await listChildren(parent, name, FOLDER_MIME);
  if (existing.length > 1) throw new Error(`Google Drive contains duplicate release folders named '${name}'.`);
  if (existing[0] !== undefined) return existing[0].id;
  const result = await driveRequest('/files?fields=id,name,mimeType&supportsAllDrives=true', { method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }) });
  return requireString(result.id, `Google Drive folder '${name}' id`);
}

async function ensureDrivePath(parent, path) {
  if (path === '.' || path === '') return parent;
  let current = parent;
  for (const segment of path.split(/[\\/]/u).filter(Boolean)) current = await getOrCreateFolder(current, segment);
  return current;
}

async function listChildren(parent, name, mimeType) {
  const query = `'${parent.replaceAll("'", "\\'")}' in parents and name = '${name.replaceAll("'", "\\'")}' and mimeType = '${mimeType}' and trashed = false`;
  const result = await driveRequest(`/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`, { method: 'GET' });
  return Array.isArray(result.files) ? result.files.filter(file => typeof file?.id === 'string') : [];
}

async function uploadFile(parent, name, path, sha256) {
  const existing = await listChildren(parent, name, mimeType(name));
  if (existing.length > 1) throw new Error(`Google Drive contains duplicate files named '${name}'.`);
  if (existing[0] !== undefined) {
    const metadata = await driveRequest(`/files/${encodeURIComponent(existing[0].id)}?fields=id,description&supportsAllDrives=true`, { method: 'GET' });
    if (metadata.description === `LotaGate-SHA256:${sha256}`) { console.log(`Already uploaded: ${name}`); return existing[0].id; }
    throw new Error(`Refusing to overwrite an existing Google Drive file with a different checksum: ${name}.`);
  }
  const size = (await stat(path)).size;
  const response = await driveFetch(`${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size&supportsAllDrives=true`, { method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': mimeType(name), 'x-upload-content-length': String(size) }, body: JSON.stringify({ name, parents: [parent], description: `LotaGate-SHA256:${sha256}` }) });
  const location = response.headers.get('location');
  if (!location) throw new Error(`Google Drive did not return an upload session for ${name}.`);
  const uploadedResponse = await driveFetch(location, { method: 'PUT', headers: { 'content-type': mimeType(name), 'content-length': String(size) }, body: createReadStream(path), duplex: 'half' });
  const result = await readJsonResponse(uploadedResponse);
  return requireString(result.id, `Google Drive file '${name}' id`);
}

async function driveRequest(path, init) {
  return readJsonResponse(await driveFetch(`${DRIVE_API}${path}`, init));
}

async function driveFetch(url, init) {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Google Drive API request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error('Google Drive returned invalid JSON.'); }
}

async function hashFile(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
async function isRegularFile(path) { try { return (await stat(path)).isFile(); } catch { return false; } }
function isInside(rootPath, candidate) { const root = resolve(rootPath) + sep; return candidate.startsWith(root); }
function requireRelativePath(value) { if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('..')) throw new Error('Release manifest contains an unsafe artifact path.'); return value; }
function requireSegment(value, label) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`Invalid ${label} in release manifest.`); return value; }
function normalizeVersion(value) { const normalized = typeof value === 'string' ? value.replace(/^desktop-v/u, '').replace(/^v/u, '') : ''; if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(normalized)) throw new Error(`Invalid release version: ${String(value)}.`); return `v${normalized}`; }
function drivePlatform(value) { if (value === 'win32') return 'windows'; if (value === 'darwin') return 'macos'; if (value === 'linux') return 'linux'; throw new Error(`Invalid platform in release manifest: ${String(value)}.`); }
function mimeType(name) { const extension = extname(name).toLowerCase(); return { '.msi': 'application/x-msi', '.dmg': 'application/x-apple-diskimage', '.pkg': 'application/octet-stream', '.deb': 'application/vnd.debian.binary-package', '.rpm': 'application/x-rpm', '.zip': 'application/zip', '.json': 'application/json' }[extension] ?? 'application/octet-stream'; }
function requireString(value, label) { if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is missing.`); return value; }
