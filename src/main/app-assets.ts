import { app } from 'electron';
import { join } from 'node:path';

export function desktopResourcePath(...segments: string[]): string {
  return app.isPackaged ? join(process.resourcesPath, ...segments) : join(app.getAppPath(), 'resources', ...segments);
}

export function desktopAssetPath(fileName: string): string {
  return desktopResourcePath('icons', fileName);
}
