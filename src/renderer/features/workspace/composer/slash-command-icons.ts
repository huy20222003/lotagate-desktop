import { AudioLines, Image, Target, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = { goal: Target, image: Image, video: Video, audio: AudioLines };
export function slashCommandIcon(commandId: string): LucideIcon { return icons[commandId.split('.')[0] ?? ''] ?? Target; }
