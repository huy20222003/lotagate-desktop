export type MediaModelCategory = 'image' | 'video' | 'speech' | 'translation' | 'transcription';

export interface WorkspaceModelOption {
  id: string;
  label: string;
  category?: string;
}

export function extractWorkspaceModels(value: unknown): WorkspaceModelOption[] {
  if (typeof value !== 'object' || value === null) return [];
  const list = (value as Record<string, unknown>)['models'];
  if (!Array.isArray(list)) return [];
  return list.flatMap(item => {
    if (typeof item === 'string') return [{ id: item, label: item }];
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'] : typeof record['model'] === 'string' ? record['model'] : undefined;
    const category = typeof record['model_category'] === 'string' ? record['model_category'] : typeof record['modelCategory'] === 'string' ? record['modelCategory'] : undefined;
    return id === undefined ? [] : [{ id, label: typeof record['label'] === 'string' ? record['label'] : id, ...(category === undefined ? {} : { category }) }];
  });
}

export function modelCategoryForCommand(commandId: string): MediaModelCategory | undefined {
  const categories: Record<string, MediaModelCategory> = {
    'image.generate': 'image',
    'image.edit': 'image',
    'video.generate': 'video',
    'audio.speech': 'speech',
    'audio.transcribe': 'transcription',
    'audio.translate': 'translation',
  };
  return categories[commandId];
}

export function filterModelsByCategory(models: readonly WorkspaceModelOption[], category: MediaModelCategory | undefined): WorkspaceModelOption[] {
  if (category === undefined) return [];
  return models.filter(model => model.category === category);
}
