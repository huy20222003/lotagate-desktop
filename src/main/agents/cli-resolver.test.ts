import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveCliExecutable } from './cli-resolver.js';

describe('resolveCliExecutable', () => {
  it('resolves the executable installed by @lotagate/cli', () => {
    const executable = resolveCliExecutable();

    expect(executable).toContain('@lotagate');
    expect(executable).toContain('lotagate.exe');
    expect(existsSync(executable)).toBe(true);
  });
});
