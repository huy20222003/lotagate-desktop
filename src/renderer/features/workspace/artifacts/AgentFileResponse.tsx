import { useCallback, useState } from 'react';
import type { Artifact } from '../../../../contracts/ipc/v1/workspace.js';
import { ArtifactFileList } from './SourceFileList.js';
import { fileArtifacts } from './source-view.js';

export function AgentFileResponse({ taskId, artifacts }: { taskId: string; artifacts: readonly Artifact[] }) {
  const files = fileArtifacts(artifacts);
  const [error, setError] = useState<string>();
  const open = useCallback(async (artifact: Artifact) => {
    setError(undefined);
    try { await window.lotagate.tasks.openArtifact(taskId, artifact.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open file.'); }
  }, [taskId]);
  const download = useCallback(async (artifact: Artifact) => {
    setError(undefined);
    try { await window.lotagate.tasks.downloadArtifact(taskId, artifact.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to download file.'); }
  }, [taskId]);
  if (files.length === 0) return null;
  return <div className="agent-file-response"><ArtifactFileList artifacts={files} variant="response" onOpen={artifact => void open(artifact)} onDownload={artifact => void download(artifact)} />{error ? <p className="agent-file-error">{error}</p> : null}</div>;
}
