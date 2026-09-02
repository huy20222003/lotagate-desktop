import type { Artifact } from '../../contracts/ipc/v1/workspace.js';

export interface AttachmentPreview {
  id: string;
  name: string;
  kind: Artifact['kind'];
  size: number;
  path?: string;
  dataUrl?: string;
}
