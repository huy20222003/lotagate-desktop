import { describe, expect, it } from 'vitest';
import { extensionNameSchema, hookNameSchema, httpUrlSchema, maxUtf8Bytes, workspaceNameSchema } from './shared.js';

describe('shared validation schemas', () => {
  it('validates shared names and URLs', () => {
    expect(workspaceNameSchema.safeParse('Workspace').success).toBe(true);
    expect(workspaceNameSchema.safeParse(' ').success).toBe(false);
    expect(extensionNameSchema.safeParse('my_extension').success).toBe(true);
    expect(hookNameSchema.safeParse('audit-hook').success).toBe(true);
    expect(httpUrlSchema.safeParse('https://example.com/mcp').success).toBe(true);
    expect(httpUrlSchema.safeParse('file:///tmp/server').success).toBe(false);
  });

  it('enforces UTF-8 byte limits', () => {
    const schema = maxUtf8Bytes(4);
    expect(schema.safeParse('éé').success).toBe(true);
    expect(schema.safeParse('ééé').success).toBe(false);
  });
});
