import { useEffect, useRef, useState } from 'react';
import type { Task, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { extractWorkspaceModels, type WorkspaceModelOption } from './model-catalog.js';
import { readSelectedModel } from './model-preference.js';

export function useWorkspaceModelCatalog(workspace: Workspace | undefined, task: Task | undefined): { models: WorkspaceModelOption[]; selectedModel: string; setSelectedModel: (model: string) => void } {
  const [models, setModels] = useState<WorkspaceModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (workspace === undefined) { setModels([]); setSelectedModel(''); return; }
    let active = true;
    void window.lotagate.agent.initialize(workspace.rootPath).then(async () => {
      const modelValue = await window.lotagate.agent.modelList(workspace.rootPath);
      const next = extractWorkspaceModels(modelValue);
      if (active && generation === requestGeneration.current) setModels(next);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [workspace]);

  useEffect(() => {
    if (models.length === 0) return;
    const preferred = task?.model ?? readSelectedModel();
    const next = preferred !== undefined && models.some(model => model.id === preferred) ? preferred : models[0]?.id ?? '';
    setSelectedModel(current => current === next ? current : next);
  }, [models, task?.id, task?.model]);

  return { models, selectedModel, setSelectedModel };
}
