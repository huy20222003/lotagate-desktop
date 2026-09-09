import type { FileOpenDestination } from '../../contracts/ipc/v1/settings.js';

export function openFilePath(path: string, destination?: FileOpenDestination): void {
  const operation = destination === undefined ? window.lotagate.operations.openFile(path) : window.lotagate.operations.openFile(path, destination);
  void operation.catch(() => undefined);
}
