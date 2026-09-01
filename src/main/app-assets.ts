import { app } from 'electron';
import { join } from 'node:path';

export function desktopAssetPath(fileName: string): string {
  return app.isPackaged ? join(process.resourcesPath, fileName) : join(app.getAppPath(), 'resources', 'icons', fileName);
}
