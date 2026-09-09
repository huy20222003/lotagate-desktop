export type CliExecutableName = 'lotagate' | 'lotagate.exe';

export function cliExecutableName(platform: NodeJS.Platform = process.platform): CliExecutableName {
  return platform === 'win32' || platform === 'cygwin' ? 'lotagate.exe' : 'lotagate';
}
