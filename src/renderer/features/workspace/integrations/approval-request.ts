import type { DesktopApprovalInput } from '../../../../contracts/ipc/v1/approval.js';

type ComposerApprovalInputOptions = {
  source: DesktopApprovalInput['source'];
  toolName: string;
  displayName?: string;
  kind?: string;
  summary: string;
  risk?: DesktopApprovalInput['risk'];
  workspaceCwd?: string;
};

export function createComposerApprovalInput(options: ComposerApprovalInputOptions): DesktopApprovalInput {
  return {
    source: options.source,
    surface: 'composer',
    toolName: options.toolName,
    ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    detail: { summary: options.summary },
    risk: options.risk ?? 'normal',
    ...(options.workspaceCwd === undefined ? {} : { workspaceCwd: options.workspaceCwd }),
  };
}
