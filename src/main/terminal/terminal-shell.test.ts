import { describe, expect, it } from 'vitest';
import { resolveTerminalShell } from './terminal-shell.js';

describe('resolveTerminalShell', () => {
  it('resolves the Windows shell choices', () => {
    const environment = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' };
    expect(resolveTerminalShell('powershell', 'win32', environment)).toEqual({ command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NoExit'] });
    expect(resolveTerminalShell('cmd', 'win32', environment)).toEqual({ command: 'cmd.exe', args: ['/d', '/q'] });
    expect(resolveTerminalShell('git-bash', 'win32', environment, value => value === 'C:\\Program Files\\Git\\bin\\bash.exe')).toEqual({ command: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'] });
  });

  it('fails clearly when Git Bash is selected but not installed', () => {
    expect(() => resolveTerminalShell('git-bash', 'win32', {}, () => false)).toThrow('Git Bash is not installed');
  });

  it('uses the configured macOS login shell and defaults to zsh', () => {
    expect(resolveTerminalShell('git-bash', 'darwin', { SHELL: '/bin/fish' })).toEqual({ command: '/bin/fish', args: ['--login', '-i'] });
    expect(resolveTerminalShell('git-bash', 'darwin', {})).toEqual({ command: '/bin/zsh', args: ['--login', '-i'] });
  });
});
