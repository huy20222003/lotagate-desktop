import { describe, expect, it } from 'vitest';

import { cliExecutableName } from './cli-executable-name.js';

describe('cliExecutableName', () => {
  it('uses the Windows extension only for Windows runtimes', () => {
    expect(cliExecutableName('win32')).toBe('lotagate.exe');
    expect(cliExecutableName('cygwin')).toBe('lotagate.exe');
    expect(cliExecutableName('darwin')).toBe('lotagate');
    expect(cliExecutableName('linux')).toBe('lotagate');
  });
});
