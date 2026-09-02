import { describe, expect, it } from 'vitest';
import * as ipcV1 from './index.js';

describe('IPC v1 public contract barrel', () => {
  it('exposes every public contract family from one stable entry point', () => {
    expect(ipcV1.desktopApprovalInputSchema).toBeDefined();
    expect(ipcV1.automationCreateInputSchema).toBeDefined();
    expect(ipcV1.extensionDetailInputSchema).toBeDefined();
    expect(ipcV1.workspaceSchema).toBeDefined();
  });
});
