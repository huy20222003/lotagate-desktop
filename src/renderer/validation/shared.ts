import { z } from 'zod';

export const workspaceNameSchema = z.string().trim().min(1, 'Display name is required.').max(120, 'Display name must not exceed 120 characters.');
export const extensionNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u, 'Name must start with a lowercase letter and be no more than 64 characters.');
export const hookNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u, 'Name must use lowercase letters, numbers, and hyphens (max 64 characters).');
export const httpUrlSchema = z.string().url().refine(value => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Server URL must use HTTP or HTTPS.');

export function maxUtf8Bytes(maximum: number) {
  return z.string().refine(value => new TextEncoder().encode(value).byteLength <= maximum, `Content must not exceed ${formatBytes(maximum)}.`);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${bytes / (1024 * 1024)} MB`;
  return `${bytes / 1024} KB`;
}
