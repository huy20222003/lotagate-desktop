import type { Artifact } from '../../contracts/ipc/v1/workspace.js';

type ArtifactMimeInput = Pick<Artifact, 'kind' | 'name'>;

export function artifactMimeType(artifact: ArtifactMimeInput): string {
  const extension = artifact.name.split('.').pop()?.toLowerCase();
  if (artifact.kind === 'image') {
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'gif') return 'image/gif';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'bmp') return 'image/bmp';
    return 'image/png';
  }
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'json') return 'application/json';
  if (extension === 'md' || extension === 'markdown') return 'text/markdown';
  if (extension === 'txt' || extension === 'log' || extension === 'csv') return 'text/plain';
  if (extension === 'xml') return 'application/xml';
  if (extension === 'html' || extension === 'htm') return 'text/html';
  if (['js', 'ts', 'tsx', 'jsx', 'css', 'scss', 'yaml', 'yml', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs', 'sql', 'sh', 'ps1', 'vue', 'mdx', 'jsonl'].includes(extension ?? '')) return 'text/plain';
  if (extension === 'zip') return 'application/zip';
  if (extension === 'doc') return 'application/msword';
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === 'xls') return 'application/vnd.ms-excel';
  if (extension === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'm4a') return 'audio/mp4';
  if (extension === 'aac') return 'audio/aac';
  if (extension === 'flac') return 'audio/flac';
  if (extension === 'ogg') return 'audio/ogg';
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'avi') return 'video/x-msvideo';
  return 'application/octet-stream';
}
