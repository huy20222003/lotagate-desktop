import type { DesktopCommandResult } from '../../services/desktop-command-client.js';
import { parseMediaCommandResult } from './media-command-result.js';
import { importMediaArtifacts } from './workspace-controller-helpers.js';
import { DESKTOP_COMMAND_TIMING_METADATA_KEY } from '../../../contracts/ipc/v1/workspace.js';

export async function persistDesktopCommandResult(taskId: string, actionId: string, result: DesktopCommandResult, startedAt: number, endedAt: number): Promise<number> {
  const media = parseMediaCommandResult(result.structured, actionId);
  const imported = media === undefined ? { artifacts: [], failures: [] } : await importMediaArtifacts(taskId, media.paths);
  const metadata = {
    command: actionId,
    [DESKTOP_COMMAND_TIMING_METADATA_KEY]: { startedAt, endedAt },
    ...(media === undefined ? {} : { mediaPaths: media.paths }),
    ...(imported.artifacts.length === 0 ? {} : { artifactIds: imported.artifacts.map(artifact => artifact.id) }),
    ...(imported.failures.length === 0 ? {} : { mediaImportFailures: imported.failures }),
  };
  if (result.content.trim() || imported.artifacts.length > 0) await window.lotagate.tasks.addActivity(taskId, 'assistant', result.content.trim(), metadata);
  return imported.failures.length;
}
