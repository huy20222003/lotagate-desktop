import { copyFile, mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { artifactSchema, type Artifact } from '../../contracts/ipc/v1/workspace.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';

export class ArtifactService {
  private readonly store = new JsonFileStore<Artifact[]>(desktopDataPath('artifacts.json'), [], value => artifactSchema.array().parse(value));

  async list(taskId: string): Promise<Artifact[]> { return (await this.store.read()).filter(artifact => artifact.taskId === taskId && artifact.deletedAt === undefined); }

  async preview(taskId: string, artifactId: string): Promise<{ artifact: Artifact; content?: string; dataUrl?: string }> {
    const artifact = await this.requireActive(taskId, artifactId);
    if (artifact.size > DESKTOP_RUNTIME_LIMITS.artifactPreviewBytes) return { artifact };
    const bytes = await readFile(artifact.path);
    if (['markdown', 'text', 'patch', 'json'].includes(artifact.kind)) return { artifact, content: bytes.toString('utf8') };
    if (artifact.kind === 'image') return { artifact, dataUrl: `data:${artifactMimeType(artifact)};base64,${bytes.toString('base64')}` };
    return { artifact };
  }

  async readMedia(taskId: string, artifactId: string): Promise<{ artifact: Artifact; mimeType: string; bytes: Uint8Array }> {
    const artifact = await this.requireActive(taskId, artifactId);
    if (!['image', 'audio', 'video'].includes(artifact.kind)) throw new Error('The artifact is not a media file.');
    if (artifact.size > DESKTOP_RUNTIME_LIMITS.attachmentBytes) throw new Error('The media artifact exceeds the supported preview size.');
    const fileBytes = await readFile(artifact.path);
    return { artifact, mimeType: artifactMimeType(artifact), bytes: Uint8Array.from(fileBytes) };
  }

  async readMediaChunk(taskId: string, artifactId: string, offset: number, length: number): Promise<{ artifact: Artifact; mimeType: string; bytes: Uint8Array }> {
    const artifact = await this.requireActive(taskId, artifactId);
    if (!['image', 'audio', 'video'].includes(artifact.kind)) throw new Error('The artifact is not a media file.');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= artifact.size) throw new Error('The media chunk offset is invalid.');
    const boundedLength = Math.min(length, DESKTOP_RUNTIME_LIMITS.artifactMediaChunkBytes, artifact.size - offset);
    const handle = await open(artifact.path, 'r');
    try {
      const bytes = Buffer.alloc(boundedLength);
      const result = await handle.read(bytes, 0, boundedLength, offset);
      return { artifact, mimeType: artifactMimeType(artifact), bytes: bytes.subarray(0, result.bytesRead) };
    } finally { await handle.close(); }
  }

  async path(taskId: string, artifactId: string): Promise<string> { return (await this.requireActive(taskId, artifactId)).path; }

  async download(taskId: string, artifactId: string, destination: string): Promise<void> {
    const artifact = await this.requireActive(taskId, artifactId);
    if (resolve(artifact.path) === resolve(destination)) return;
    await copyFile(artifact.path, destination);
  }

  async attachmentInputs(taskId: string, artifactIds: string[]): Promise<Array<{ id: string; name: string; mimeType: string; sizeBytes: number; path: string }>> {
    const artifacts = await this.list(taskId);
    return artifactIds.map(id => {
      const artifact = artifacts.find(item => item.id === id);
      if (artifact === undefined) throw new Error('Attachment artifact was not found.');
      if (artifact.size <= 0 || artifact.size > DESKTOP_RUNTIME_LIMITS.attachmentBytes) throw new Error('The attachment exceeds the supported size limit.');
      return { id: artifact.id, name: artifact.name, mimeType: artifactMimeType(artifact), sizeBytes: artifact.size, path: artifact.path };
    });
  }

  async importFile(taskId: string, sourcePath: string, kind: Artifact['kind']): Promise<Artifact> {
    const details = await stat(sourcePath);
    if (!details.isFile()) throw new Error('The selected artifact must be a file.');
    if (details.size <= 0 || details.size > DESKTOP_RUNTIME_LIMITS.attachmentBytes) throw new Error('The selected artifact exceeds the supported size limit.');
    const destinationDirectory = join(desktopDataPath('artifacts'), taskId);
    await mkdir(destinationDirectory, { recursive: true });
    const destination = join(destinationDirectory, `${randomUUID()}-${basename(sourcePath)}`);
    try {
      await copyFile(sourcePath, destination);
      const artifact = artifactSchema.parse({ id: randomUUID(), taskId, name: basename(sourcePath), path: destination, kind, size: details.size, createdAt: new Date().toISOString() });
      await this.store.update(current => [...current, artifact]);
      return artifact;
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      throw error;
    }
  }

  async createText(taskId: string, name: string, content: string, kind: Extract<Artifact['kind'], 'text' | 'markdown' | 'patch' | 'json'> = 'text'): Promise<Artifact> {
    const safeName = basename(name).replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120) || 'artifact.txt';
    const directory = join(desktopDataPath('artifacts'), taskId);
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${randomUUID()}-${safeName}`);
    await writeFile(path, content, 'utf8');
    const artifact = artifactSchema.parse({ id: randomUUID(), taskId, name: safeName, path, kind, size: Buffer.byteLength(content, 'utf8'), createdAt: new Date().toISOString() });
    await this.store.update(current => [...current, artifact]);
    return artifact;
  }

  async createImage(taskId: string, name: string, bytes: Uint8Array): Promise<Artifact> {
    if (bytes.byteLength === 0 || bytes.byteLength > DESKTOP_RUNTIME_LIMITS.attachmentBytes) throw new Error('The image attachment exceeds the supported size limit.');
    return this.createBytes(taskId, name, bytes, 'image');
  }

  async createMedia(taskId: string, name: string, bytes: Uint8Array, kind: Extract<Artifact['kind'], 'audio' | 'video'>): Promise<Artifact> {
    if (bytes.byteLength === 0 || bytes.byteLength > DESKTOP_RUNTIME_LIMITS.attachmentBytes) throw new Error('The media attachment exceeds the supported size limit.');
    return this.createBytes(taskId, name, bytes, kind);
  }

  async createBinary(taskId: string, name: string, bytes: Uint8Array): Promise<Artifact> {
    if (bytes.byteLength === 0 || bytes.byteLength > DESKTOP_RUNTIME_LIMITS.attachmentBytes) throw new Error('The file attachment exceeds the supported size limit.');
    return this.createBytes(taskId, name, bytes, 'binary');
  }

  private async createBytes(taskId: string, name: string, bytes: Uint8Array, kind: Extract<Artifact['kind'], 'image' | 'audio' | 'video' | 'binary'>): Promise<Artifact> {
    const safeName = basename(name).replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120) || 'pasted-image.png';
    const directory = join(desktopDataPath('artifacts'), taskId);
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${randomUUID()}-${safeName}`);
    await writeFile(path, bytes);
    const artifact = artifactSchema.parse({ id: randomUUID(), taskId, name: safeName, path, kind, size: bytes.byteLength, createdAt: new Date().toISOString() });
    await this.store.update(current => [...current, artifact]);
    return artifact;
  }

  async delete(taskId: string, artifactId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error('Artifact deletion requires explicit confirmation.');
    let path: string | undefined;
    await this.store.update(current => {
      const index = current.findIndex(item => item.taskId === taskId && item.id === artifactId && item.deletedAt === undefined);
      if (index < 0) throw new Error('Artifact was not found.');
      const artifact = current[index]!;
      path = artifact.path;
      const next = [...current];
      next[index] = { ...artifact, deletedAt: new Date().toISOString() };
      return next;
    });
    if (path) await unlink(path).catch(() => undefined);
  }

  private async requireActive(taskId: string, artifactId: string): Promise<Artifact> {
    const artifact = (await this.list(taskId)).find(item => item.id === artifactId);
    if (artifact === undefined) throw new Error('Artifact was not found.');
    return artifact;
  }
}

function artifactMimeType(artifact: Artifact): string {
  if (artifact.kind !== 'image') {
    const extension = artifact.name.split('.').pop()?.toLowerCase();
    if (extension === 'pdf') return 'application/pdf';
    if (extension === 'json') return 'application/json';
    if (extension === 'md' || extension === 'markdown') return 'text/markdown';
    if (extension === 'txt' || extension === 'log' || extension === 'csv') return 'text/plain';
    if (extension === 'xml') return 'application/xml';
    if (extension === 'html' || extension === 'htm') return 'text/html';
    if (['js', 'ts', 'tsx', 'jsx', 'css', 'scss', 'html', 'htm', 'xml', 'yaml', 'yml', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs', 'sql', 'sh', 'ps1', 'vue', 'mdx', 'jsonl'].includes(extension ?? '')) return 'text/plain';
    if (extension === 'zip') return 'application/zip';
    if (extension === 'doc') return 'application/msword';
    if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (extension === 'xls') return 'application/vnd.ms-excel';
    if (extension === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (extension === 'mp3') return 'audio/mpeg';
    if (extension === 'wav') return 'audio/wav';
    if (extension === 'm4a') return 'audio/mp4';
    if (extension === 'aac') return 'audio/aac';
    if (extension === 'flac') return 'audio/flac';
    if (extension === 'ogg') return 'audio/ogg';
    if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
    if (extension === 'webm') return 'video/webm';
    if (extension === 'mov') return 'video/quicktime';
    if (extension === 'avi') return 'video/x-msvideo';
    return 'application/octet-stream';
  }
  const name = artifact.name;
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'bmp') return 'image/bmp';
  return 'image/png';
}
