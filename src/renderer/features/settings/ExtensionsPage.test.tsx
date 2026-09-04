// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui.js';
import { ExtensionsPage } from './ExtensionsPage.js';

const extensionClientMocks = vi.hoisted(() => ({
  listCommands: vi.fn(),
  list: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('./extension-command-client.js', async () => {
  const actual = await vi.importActual<typeof import('./extension-command-client.js')>('./extension-command-client.js');
  return {
    ...actual,
    ExtensionCommandClient: class {
      listCommands = extensionClientMocks.listCommands;
      list = extensionClientMocks.list;
      execute = extensionClientMocks.execute;
    },
  };
});

describe('ExtensionsPage', () => {
  beforeEach(() => {
    extensionClientMocks.listCommands.mockReset().mockResolvedValue(new Set(['plugin.install']));
    extensionClientMocks.list.mockReset().mockResolvedValue([
      { name: 'review', status: 'ENABLED', detail: 'builtin · Review code.', scope: 'builtin' },
    ]);
    extensionClientMocks.execute.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('settles extension loading under React StrictMode', async () => {
    render(<StrictMode><ToastProvider><ExtensionsPage kind="skill" cwd="C:\\workspace" /></ToastProvider></StrictMode>);

    await waitFor(() => expect(screen.getByText('review')).toBeVisible());
  });

  it('does not render a runtime connection card on the MCP page', async () => {
    render(<ToastProvider><ExtensionsPage kind="mcp" cwd="C:\\workspace" /></ToastProvider>);

    await waitFor(() => expect(screen.getByText('review')).toBeVisible());
    expect(screen.queryByText('Runtime connections')).not.toBeInTheDocument();
  });
});
