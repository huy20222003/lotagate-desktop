import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class CheckpointObjectStore {
  constructor(private readonly directory: string) {}

  async put(kind: 'file' | 'symlink', bytes: Buffer): Promise<{ hash: string; size: number }> {
    const hash = hashObject(kind, bytes);
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, hash);
    if (await exists(target)) return { hash, size: bytes.byteLength };
    const temporary = join(this.directory, `.${hash}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporary, bytes, { flag: 'wx' });
    try { await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => undefined); if (!(await exists(target))) throw error; }
    return { hash, size: bytes.byteLength };
  }

  async read(hash: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('Invalid checkpoint object hash.');
    return readFile(join(this.directory, hash));
  }

  async removeUnreferenced(referenced: ReadonlySet<string>): Promise<void> {
    let entries: string[];
    try { entries = await readdir(this.directory); } catch { return; }
    await Promise.all(entries.filter(name => /^[a-f0-9]{64}$/u.test(name) && !referenced.has(name)).map(name => unlink(join(this.directory, name)).catch(() => undefined)));
  }

  async sizes(): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    let entries: string[];
    try { entries = await readdir(this.directory); } catch { return sizes; }
    for (const name of entries.filter(item => /^[a-f0-9]{64}$/u.test(item))) {
      const details = await stat(join(this.directory, name)).catch(() => undefined);
      if (details !== undefined) sizes.set(name, details.size);
    }
    return sizes;
  }
}

export function hashObject(kind: 'file' | 'symlink', bytes: Buffer): string { return createHash('sha256').update(kind).update('\0').update(bytes).digest('hex'); }

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
