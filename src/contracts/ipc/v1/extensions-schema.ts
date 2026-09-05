import { z } from 'zod';

const hookEventSchema = z.enum(['session.start', 'prompt.before', 'tool.before', 'tool.after', 'response.after', 'session.end']);

export const extensionDetailInputSchema = z.object({
  kind: z.enum(['hook', 'skill', 'plugin', 'mcp']),
  cwd: z.string().min(1).max(4_096),
  name: z.string().min(1).max(256),
  scope: z.enum(['user', 'project', 'plugin', 'builtin']).optional(),
  pluginName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u).optional(),
  pluginScope: z.enum(['user', 'project']).optional(),
  sourceName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u).optional(),
});

export const extensionDetailWriteInputSchema = extensionDetailInputSchema.extend({ content: z.string().min(1).max(2 * 1024 * 1024) });
export const pluginIconInputSchema = z.object({ cwd: z.string().min(1).max(4_096), name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u), scope: z.enum(['user', 'project']) }).strict();
export const publicPluginContributionInputSchema = z.object({ pluginName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u), kind: z.enum(['skill', 'mcp', 'hook']), sourceName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u) }).strict();
export const hookCreateInputSchema = z.object({ cwd: z.string().min(1).max(4_096), name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u), event: hookEventSchema, command: z.string().trim().min(1).max(512), args: z.array(z.string().max(16_384)).max(128), timeoutMs: z.number().int().min(100).max(120_000) });
export const hookRemoveInputSchema = z.object({ cwd: z.string().min(1).max(4_096), name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u) });
