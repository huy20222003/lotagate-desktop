import { describe, expect, it } from 'vitest';
import { parseExtensionRows } from './extension-command-client.js';

describe('extension command output parser', () => {
  it('parses the shared CLI compact table and scope', () => {
    const rows = parseExtensionRows('Name      Status    Detail\nserver    ENABLED   project · http · https://example.test/mcp', 'mcp');

    expect(rows).toEqual([{ name: 'server', status: 'ENABLED', detail: 'project · http · https://example.test/mcp', scope: 'project' }]);
  });

  it('parses hook rows without inventing a scope', () => {
    const rows = parseExtensionRows('Name      Status    Detail\npre-commit  before  npm test', 'hook');

    expect(rows[0]?.scope).toBeUndefined();
    expect(rows[0]?.name).toBe('pre-commit');
  });
});
