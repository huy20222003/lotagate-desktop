import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';

export type DesktopMediaType = Extract<Artifact['kind'], 'image' | 'audio' | 'video'>;

export interface DesktopMediaCommandResult {
  readonly mediaType: DesktopMediaType;
  readonly paths: readonly string[];
}

const ACTION_MEDIA_TYPES: Readonly<Record<string, DesktopMediaType>> = {
  'image.generate': 'image',
  'image.edit': 'image',
  'audio.speech': 'audio',
  'video.generate': 'video',
  'video.download': 'video',
};

export function parseMediaCommandResult(value: unknown, actionId: string): DesktopMediaCommandResult | undefined {
  if (!isRecord(value) || value['kind'] !== 'media') return undefined;
  const expectedType = ACTION_MEDIA_TYPES[actionId];
  const mediaType = value['mediaType'];
  if (expectedType === undefined || !isMediaType(mediaType) || mediaType !== expectedType) return undefined;
  const artifacts = value['artifacts'];
  if (!Array.isArray(artifacts) || artifacts.length === 0 || artifacts.length > 32) return undefined;
  const paths = artifacts.map(item => isRecord(item) ? item['path'] : undefined);
  if (paths.some(path => typeof path !== 'string' || path.length === 0 || path.length > 4_096 || path.includes('\0'))) return undefined;
  return { mediaType, paths: paths as string[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMediaType(value: unknown): value is DesktopMediaType {
  return value === 'image' || value === 'audio' || value === 'video';
}
