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

  it('parses plugin-owned rows without dropping their ownership', () => {
    const rows = parseExtensionRows({ kind: 'skill', items: [{ name: 'example:review', status: 'ENABLED', detail: 'plugin · Review changes', scope: 'plugin', pluginName: 'example', sourceName: 'review' }] }, 'skill');

    expect(rows).toEqual([{ name: 'example:review', status: 'ENABLED', detail: 'plugin · Review changes', scope: 'plugin', pluginName: 'example', sourceName: 'review' }]);
  });

  it('keeps plugin metadata and parses read-only detail contributions', () => {
    const rows = parseExtensionRows({ kind: 'plugin', items: [{ name: 'example', status: 'ENABLED', detail: 'user · v1.2.3', description: 'Example plugin', version: '1.2.3', scope: 'user' }] }, 'plugin');
    expect(rows[0]).toMatchObject({ name: 'example', description: 'Example plugin', version: '1.2.3', scope: 'user' });
  });
});
