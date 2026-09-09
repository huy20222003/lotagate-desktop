import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliExecutableName } from './cli-executable-name.js';
import { resolveCliInvocation, resolveCliPackageInvocation } from './cli-resolver.js';

describe('resolveCliInvocation', () => {
  it('resolves the executable installed by @lotagate/cli', () => {
    const invocation = resolveCliInvocation();

    expect(existsSync(invocation.executable)).toBe(true);
    if (invocation.executableArgs.length === 0) {
      expect(invocation.executable).toContain(cliExecutableName());
    } else {
      expect(invocation.executable).not.toMatch(/electron(?:\.exe)?$/iu);
      expect(invocation.executableArgs[0]).toContain('lotagate.mjs');
      expect(existsSync(invocation.executableArgs[0] as string)).toBe(true);
    }
  });

  it('does not fall back to an external Node launcher for an incomplete package', () => {
    expect(() => resolveCliPackageInvocation('C:\\app.asar\\node_modules\\@lotagate\\cli', { exists: () => false })).toThrow(/packaged @lotagate\/cli executable was not installed/u);
  });

  it('resolves the native package artifact on Unix hosts', () => {
    const invocation = resolveCliPackageInvocation('/app/node_modules/@lotagate/cli', {
      platform: 'linux',
      exists: path => path.replaceAll('\\', '/').endsWith('/bin/lotagate.exe'),
    });
    expect(invocation.executable.replaceAll('\\', '/')).toBe('/app/node_modules/@lotagate/cli/bin/lotagate.exe');
    expect(invocation.executableArgs).toEqual([]);
  });

  it('keeps the Node launcher fallback limited to a linked development package', () => {
    const packageRoot = join('workspace', 'cli');
    const launcher = join(packageRoot, 'bin', 'lotagate.mjs');
    const invocation = resolveCliPackageInvocation(packageRoot, {
      exists: path => path === join(packageRoot, '.git') || path === launcher,
      nodeExecutable: 'node.exe',
    });
    expect(invocation).toEqual({ executable: 'node.exe', executableArgs: [launcher] });
  });
});
