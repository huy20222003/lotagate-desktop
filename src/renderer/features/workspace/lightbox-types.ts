export type LightBoxMediaKind = 'image' | 'video';

export interface LightBoxMediaItem {
  id: string;
  name: string;
  src: string;
  kind: LightBoxMediaKind;
  downloadName?: string;
  onDownload?: () => void;
}
