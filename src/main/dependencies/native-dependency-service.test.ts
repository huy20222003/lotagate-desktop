import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));

import { NativeDependencyService } from './native-dependency-service.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  mocks.execFile.mockReset();
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('NativeDependencyService', () => {
  it('does not install optional host dependencies during automatic startup bootstrap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lotagate-native-dependencies-'));
    temporaryDirectories.push(directory);
    const manifestPath = join(directory, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      dependencies: [
        { id: 'optional.integration', label: 'Optional integration', automaticInstall: false, platforms: ['win32'], probe: { type: 'command', command: 'optional-helper' }, install: { win32: { manager: 'winget', packageId: 'Optional.Package' } } },
        { id: 'computer.helper', label: 'Computer helper', platforms: ['win32'], probe: { type: 'command', command: 'computer-helper' }, install: { win32: { manager: 'winget', packageId: 'Computer.Package' } } },
      ],
    }), 'utf8');

    const available = new Set(['winget.exe']);
    mocks.execFile.mockImplementation((command: string, args: readonly string[], _options: unknown, callback: (error: Error | null, stdout?: string, stderr?: string) => void) => {
      const child = new EventEmitter();
      if (command === 'where.exe') {
        if (available.has(String(args[0]))) callback(null, '', '');
        else callback(new Error('not found'));
      } else if (command === 'winget.exe') {
        if (args.includes('Computer.Package')) available.add('computer-helper');
        callback(null, '', '');
      } else callback(new Error('unexpected command'));
      return child;
    });

    const service = new NativeDependencyService({ manifestPath, log: vi.fn() });
    const startupReport = await service.ensureInstalled(true);
    const completeReport = await service.inspectCurrent();

    expect(startupReport.statuses.map(status => status.id)).toEqual(['computer.helper']);
    expect(completeReport.missing).toContain('optional.integration');
    expect(mocks.execFile.mock.calls.some(call => call[0] === 'winget.exe' && call[1].includes('Optional.Package'))).toBe(false);
    expect(mocks.execFile.mock.calls.some(call => call[0] === 'winget.exe' && call[1].includes('Computer.Package'))).toBe(true);
  });
});
