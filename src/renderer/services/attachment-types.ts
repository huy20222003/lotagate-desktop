import type { Artifact } from '../../contracts/ipc/v1/workspace.js';

export interface AttachmentPreview {
  id: string;
  name: string;
  kind: Artifact['kind'];
  source?: Artifact['source'];
  size: number;
  path?: string;
  dataUrl?: string;
  subtitle?: string;
}
