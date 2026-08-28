import { extname } from 'node:path';
import type { Artifact } from '../../contracts/ipc/v1/workspace.js';

export function artifactKind(path: string): Artifact['kind'] {
  const extension = extname(path).slice(1).toLowerCase();
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'json') return 'json';
  if (extension === 'patch' || extension === 'diff') return 'patch';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension)) return 'image';
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(extension)) return 'audio';
  if (['mp4', 'webm', 'mov', 'm4v', 'avi'].includes(extension)) return 'video';
  if (['txt', 'log', 'csv', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'htm', 'xml', 'yaml', 'yml', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs', 'sql', 'sh', 'ps1', 'vue', 'mdx', 'jsonl'].includes(extension)) return 'text';
  return 'binary';
}
