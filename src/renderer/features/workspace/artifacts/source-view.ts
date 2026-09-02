import type { Artifact } from '../../../../contracts/ipc/v1/workspace.js';

export type SourceTab = 'media' | 'audio' | 'files';

export const SOURCE_TABS: Array<{ value: SourceTab; label: string }> = [
  { value: 'media', label: 'Images & videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'files', label: 'Other files' },
];

export type VisualArtifact = Omit<Artifact, 'kind'> & { kind: 'image' | 'video' };
export function mediaArtifacts(artifacts: readonly Artifact[]): VisualArtifact[] { return artifacts.filter((artifact): artifact is VisualArtifact => artifact.kind === 'image' || artifact.kind === 'video'); }
export function audioArtifacts(artifacts: readonly Artifact[]): Artifact[] { return artifacts.filter(artifact => artifact.kind === 'audio'); }
export function fileArtifacts(artifacts: readonly Artifact[]): Artifact[] { return artifacts.filter(artifact => artifact.kind !== 'image' && artifact.kind !== 'video' && artifact.kind !== 'audio'); }

export function formatArtifactSize(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1_024 * 1_024) return `${Math.round(size / 1_024)} KB`;
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function artifactTypeLabel(artifact: Artifact): string {
  if (artifact.kind === 'binary') return 'Binary file';
  return artifact.kind.charAt(0).toUpperCase() + artifact.kind.slice(1);
}

export function isInlinePreviewableArtifact(artifact: Artifact): boolean {
  return artifact.kind === 'text' || artifact.kind === 'markdown' || artifact.kind === 'patch' || artifact.kind === 'json';
}

export function artifactMediaBlob(bytes: Uint8Array, mimeType: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: mimeType });
}
