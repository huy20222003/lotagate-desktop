import { describe, expect, it } from 'vitest';
import { createChildProcessEnvironment } from './process-environment.js';

describe('createChildProcessEnvironment', () => {
  it('preserves arbitrary project and toolchain variables', () => {
    expect(createChildProcessEnvironment({
      platform: 'linux',
      environment: { PATH: '/bin', PROJECT_RUNTIME: 'custom', API_TOKEN: 'secret', OMITTED: undefined },
    })).toEqual({ PATH: '/bin', PROJECT_RUNTIME: 'custom', API_TOKEN: 'secret' });
  });

  it('normalizes case-insensitive Windows PATH keys and applies overrides', () => {
    expect(createChildProcessEnvironment({
      platform: 'win32',
      environment: { Path: 'C:\\Windows\\System32', PATH: 'duplicate', PROJECT_RUNTIME: 'custom' },
      overrides: { PROJECT_RUNTIME: 'interactive', TERM: 'xterm' },
    })).toEqual({ Path: 'C:\\Windows\\System32', PROJECT_RUNTIME: 'interactive', TERM: 'xterm' });
  });
});
