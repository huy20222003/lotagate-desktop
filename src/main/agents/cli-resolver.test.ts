import { existsSync } from 'node:fs';
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

  it('keeps the Node launcher fallback limited to a linked development package', () => {
    const invocation = resolveCliPackageInvocation('C:\\workspace\\cli', {
      exists: path => path.endsWith('\\.git') || path.endsWith('\\bin\\lotagate.mjs'),
      nodeExecutable: 'node.exe',
    });
    expect(invocation).toEqual({ executable: 'node.exe', executableArgs: ['C:\\workspace\\cli\\bin\\lotagate.mjs'] });
  });
});
