import { CHECKPOINT_RETENTION_DAYS } from '../../contracts/ipc/v1/workspace.js';

export const MAX_CHECKPOINTS = 100;
export const MAX_CHECKPOINT_AGE_MS = CHECKPOINT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
export const MAX_OBJECT_BYTES = 512 * 1024 * 1024;
export const IGNORED_DIRECTORIES = new Set(['.git', '.lotagate']);
export const DOCUMENT_READ_ACTIONS = new Set(['open', 'inspect', 'validate', 'readText', 'extractTables', 'readForm', 'readSlide', 'readRange', 'readContent']);
