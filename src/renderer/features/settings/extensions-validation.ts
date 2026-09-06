import { z } from 'zod';
import { extensionNameSchema, hookNameSchema, httpUrlSchema, maxUtf8Bytes } from '../../validation/shared.js';
import { isRecord, readString } from '../../utils/data.js';
import type { DesktopHookEvent } from '../../../contracts/ipc/v1/extensions.js';
import { hookEventOptions, type ValidationErrors } from './extensions-view-types.js';

export function parseObject(content: string): Record<string, unknown> | undefined { try { const value: unknown = JSON.parse(content); return isRecord(value) ? value : undefined; } catch { return undefined; } }
export function parseHook(value: Record<string, unknown> | undefined): { event: DesktopHookEvent; command: string; args: string[]; timeoutMs: number } { const event = hookEventOptions.some(option => option.value === value?.['event']) ? value?.['event'] as DesktopHookEvent : 'session.start'; const command = readString(value?.['command']) ?? ''; const rawArgs = value?.['args']; const args = Array.isArray(rawArgs) ? rawArgs.filter((item): item is string => typeof item === 'string') : []; const timeoutMs = typeof value?.['timeoutMs'] === 'number' ? value['timeoutMs'] : 10000; return { event, command, args, timeoutMs }; }
export function parseArgs(value: string): string[] { return value.split(',').map(item => item.trim()).filter(Boolean); }
export function validateHookName(value: string): string | undefined { const result = hookNameSchema.safeParse(value.trim()); return result.success ? undefined : result.error.issues[0]?.message; }
export function validateHookFields(command: string, args: string, timeoutMs: string): ValidationErrors { const result: ValidationErrors = {}; const normalizedCommand = command.trim(); if (!z.string().min(1).max(512).safeParse(normalizedCommand).success) result['command'] = normalizedCommand ? 'Command must not exceed 512 characters.' : 'Command is required.'; const parsedArgs = parseArgs(args); if (!z.array(z.string().max(16_384)).max(128).safeParse(parsedArgs).success) result['args'] = parsedArgs.length > 128 ? 'Args must contain no more than 128 values.' : 'Each argument must not exceed 16,384 characters.'; if (!z.string().regex(/^\d+$/u).refine(value => Number.isSafeInteger(Number(value)) && Number(value) >= 100 && Number(value) <= 120_000).safeParse(timeoutMs.trim()).success) result['timeoutMs'] = 'Timeout must be an integer between 100 and 120,000 ms.'; return result; }
export function validateMcpFields(_type: string, url: string): ValidationErrors { const normalized = url.trim(); if (!z.string().min(1).safeParse(normalized).success) return { url: 'Server URL is required.' }; return httpUrlSchema.safeParse(normalized).success ? {} : { url: 'Server URL must use HTTP or HTTPS.' }; }
export function validateExtensionName(value: string): string | undefined { const result = extensionNameSchema.safeParse(value.trim().toLowerCase()); return result.success ? undefined : result.error.issues[0]?.message; }
export function validateExtensionSource(value: string): string | undefined { const source = value.trim(); return z.string().min(1).max(4_096).safeParse(source).success ? undefined : source.length === 0 ? 'Source is required.' : 'Source must not exceed 4,096 characters.'; }
export function validatePluginIntegrity(sha256: string, signature: string, publicKey: string): ValidationErrors {
  const errors: ValidationErrors = {};
  const digest = sha256.trim();
  if (digest.length > 0 && !/^[a-f0-9]{64}$/iu.test(digest)) errors['sha256'] = 'SHA-256 must contain exactly 64 hexadecimal characters.';
  if ((signature.trim().length === 0) !== (publicKey.trim().length === 0)) errors['signature'] = 'Signature and public key must be provided together.';
  return errors;
}
export function validateContent(value: string): ValidationErrors { return maxUtf8Bytes(2 * 1024 * 1024).safeParse(value).success ? {} : { content: 'Content must not exceed 2 MB.' }; }
export function firstValidationError(errors: ValidationErrors): string | undefined { return Object.values(errors).find((value): value is string => value !== undefined); }
