import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonFileStore<T> {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly fallback: T) {}

  async read(): Promise<T> {
    await this.writeChain;
    return this.readFromDisk();
  }

  async update(mutator: (current: T) => T | Promise<T>): Promise<T> {
    let result!: T;
    await this.enqueue(async () => {
      const current = await this.readFromDisk();
      result = await mutator(current);
      await this.writeToDisk(result);
    });
    return result;
  }

  async write(value: T): Promise<void> {
    await this.enqueue(() => this.writeToDisk(value));
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeChain.catch(() => undefined).then(operation);
    this.writeChain = next;
    await next;
  }

  private async readFromDisk(): Promise<T> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if (isMissingFile(error)) return this.fallback;
      throw error;
    }
  }

  private async writeToDisk(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await rename(temporary, this.filePath);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
