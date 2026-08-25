import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { artifactSchema, type Artifact } from '../../contracts/ipc/v1/workspace.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

export class ArtifactService {
  private readonly store = new JsonFileStore<Artifact[]>(desktopDataPath('artifacts.json'), []);

  async list(taskId: string): Promise<Artifact[]> { return (await this.store.read()).filter(artifact => artifact.taskId === taskId && artifact.deletedAt === undefined); }

  async preview(taskId: string, artifactId: string): Promise<{ artifact: Artifact; content?: string; dataUrl?: string }> {
    const artifact = (await this.list(taskId)).find(item => item.id === artifactId);
    if (artifact === undefined) throw new Error('Artifact was not found.');
    if (artifact.size > 2 * 1024 * 1024) return { artifact };
    const bytes = await readFile(artifact.path);
    if (['markdown', 'text', 'patch', 'json'].includes(artifact.kind)) return { artifact, content: bytes.toString('utf8') };
    if (artifact.kind === 'image') return { artifact, dataUrl: `data:image/${artifact.name.split('.').pop() ?? 'png'};base64,${bytes.toString('base64')}` };
    return { artifact };
  }

  async path(taskId: string, artifactId: string): Promise<string> { const artifact = (await this.list(taskId)).find(item => item.id === artifactId); if (artifact === undefined) throw new Error('Artifact was not found.'); return artifact.path; }

  async importFile(taskId: string, sourcePath: string, kind: Artifact['kind']): Promise<Artifact> {
    const details = await stat(sourcePath);
    const destinationDirectory = join(desktopDataPath('artifacts'), taskId);
    await mkdir(destinationDirectory, { recursive: true });
    const destination = join(destinationDirectory, `${randomUUID()}-${basename(sourcePath)}`);
    await copyFile(sourcePath, destination);
    const artifact = artifactSchema.parse({ id: randomUUID(), taskId, name: basename(sourcePath), path: destination, kind, size: details.size, createdAt: new Date().toISOString() });
    await this.store.update(current => [...current, artifact]);
    return artifact;
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
}
