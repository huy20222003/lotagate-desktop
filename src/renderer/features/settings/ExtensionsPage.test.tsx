// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('reports extension loading failures through the shared toast', async () => {
    extensionClientMocks.listCommands.mockRejectedValueOnce(new Error('CLI event failed.'));
    render(<ToastProvider><ExtensionsPage kind="mcp" cwd="C:\\workspace" /></ToastProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load mcp');
    expect(screen.queryByText('Unable to load mcp', { selector: '.settings-extension-error strong' })).not.toBeInTheDocument();
  });

  it('renders skill metadata in a card and keeps enable action in the item menu', async () => {
    extensionClientMocks.list.mockResolvedValueOnce([{ name: 'review', status: 'ENABLED', detail: 'user · Review the workspace carefully.', scope: 'user', sourceName: 'review' }]);
    render(<ToastProvider><ExtensionsPage kind="skill" cwd={'C:\\workspace'} /></ToastProvider>);

    expect(await screen.findByText('review')).toBeVisible();
    expect(screen.getByText('Review the workspace carefully.')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for review' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable' }));
    await waitFor(() => expect(extensionClientMocks.execute).toHaveBeenCalledWith('C:\\workspace', { actionId: 'skill.disable', positionals: ['review'], options: { scope: 'user' } }));
  });

  it('uses the MCP type and hook event as the card secondary content', async () => {
    extensionClientMocks.list.mockResolvedValueOnce([{ name: 'docs', status: 'ENABLED', detail: 'user · http · https://example.test/mcp', scope: 'user' }]);
    render(<ToastProvider><ExtensionsPage kind="mcp" cwd={'C:\\workspace'} /></ToastProvider>);
    expect(await screen.findByText('Type: http')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Actions for docs' })).toBeVisible();

    cleanup();
    window.lotagate = { extensions: { listProjectHooks: vi.fn().mockResolvedValue(['pre-commit']) } } as unknown as typeof window.lotagate;
    extensionClientMocks.list.mockResolvedValueOnce([{ name: 'pre-commit', status: 'tool.before', detail: 'node check.js · 10000ms', scope: 'project', editable: true }]);
    render(<ToastProvider><ExtensionsPage kind="hook" cwd={'C:\\workspace'} trusted /></ToastProvider>);
    expect(await screen.findByText('Event: tool.before')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Actions for pre-commit' })).toBeVisible();
  });
});
