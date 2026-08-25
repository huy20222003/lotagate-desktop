import { app } from 'electron';
import { join } from 'node:path';

export function desktopDataPath(fileName: string): string {
  return join(app.getPath('userData'), 'desktop-data', fileName);
}
