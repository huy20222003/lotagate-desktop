export type CheckpointEntryKind = 'file' | 'symlink';
export type CheckpointMutationKind = 'created' | 'modified' | 'deleted' | 'renamed';
export type CheckpointState = 'active' | 'ready' | 'undone' | 'conflict' | 'failed' | 'recovery';

export interface CheckpointEntry {
  kind: CheckpointEntryKind;
  hash: string;
  objectHash: string;
  size: number;
}

export interface CheckpointMutation {
  sequence: number;
  kind: CheckpointMutationKind;
  path: string;
  fromPath?: string;
  before?: CheckpointEntry;
  after?: CheckpointEntry;
}

export interface CheckpointRecord {
  id: string;
  type: 'turn' | 'recovery';
  workspaceRoot: string;
  taskId: string;
  sessionId?: string;
  turnId: string;
  createdAt: string;
  state: CheckpointState;
  mutations: CheckpointMutation[];
  sourceCheckpointId?: string;
}

export interface WorkspaceEntry {
  kind: CheckpointEntryKind;
  bytes: Buffer;
}
