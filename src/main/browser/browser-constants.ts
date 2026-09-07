import type { BrowserViewBounds } from '../../contracts/ipc/v1/workspace.js';

export const MAX_CONSOLE_ENTRIES = 200;
export const MAX_ERROR_ENTRIES = 100;
export const MAX_NETWORK_ENTRIES = 300;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_RECORDING_FRAMES = 30;
export const EMPTY_BOUNDS: BrowserViewBounds = { x: 0, y: 0, width: 0, height: 0 };
export const PERSISTENT_BROWSER_PARTITION = 'persist:lotagate-browser-default';
