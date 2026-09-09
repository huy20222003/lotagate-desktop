import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cliExecutableName } from './cli-executable-name.js';
import { resolveCliInvocation } from './cli-resolver.js';

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
});
