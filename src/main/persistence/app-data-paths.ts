import { app } from 'electron';
import { join } from 'node:path';

export const DESKTOP_DATA_DIRECTORIES = {
  root: 'desktop-data',
  logs: 'logs',
  cache: 'cache',
} as const;

export function desktopDataDirectory(directory = ''): string {
  return join(app.getPath('userData'), DESKTOP_DATA_DIRECTORIES.root, directory);
}

export function desktopDataPath(fileName: string): string {
  return desktopDataDirectory(fileName);
}
