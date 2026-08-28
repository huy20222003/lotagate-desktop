import { describe, expect, it } from 'vitest';
import { parseExtensionRows } from './extension-command-client.js';

describe('extension command output parser', () => {
  it('parses the shared CLI structured payload and explicit scope', () => {
    const rows = parseExtensionRows({ kind: 'mcp', items: [{ name: 'server', status: 'ENABLED', detail: 'project · http · https://example.test/mcp', scope: 'project' }] }, 'mcp');

    expect(rows).toEqual([{ name: 'server', status: 'ENABLED', detail: 'project · http · https://example.test/mcp', scope: 'project' }]);
  });

  it('parses hook rows without inventing a scope', () => {
    const rows = parseExtensionRows({ kind: 'hook', items: [{ name: 'pre-commit', status: 'before', detail: 'npm test' }] }, 'hook');

    expect(rows[0]?.scope).toBeUndefined();
    expect(rows[0]?.name).toBe('pre-commit');
  });
});
