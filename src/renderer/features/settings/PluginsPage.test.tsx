// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui.js';
import { PluginsPage } from './PluginsPage.js';

const mocks = vi.hoisted(() => ({ listCommands: vi.fn(), list: vi.fn(), execute: vi.fn(), detail: vi.fn() }));

vi.mock('./extension-command-client.js', async () => {
  const actual = await vi.importActual<typeof import('./extension-command-client.js')>('./extension-command-client.js');
  return { ...actual, ExtensionCommandClient: class { listCommands = mocks.listCommands; list = mocks.list; execute = mocks.execute; detail = mocks.detail; } };
});

describe('PluginsPage', () => {
  beforeEach(() => {
    mocks.listCommands.mockReset().mockResolvedValue(new Set(['plugin.install', 'plugin.uninstall']));
    mocks.list.mockReset().mockResolvedValue([{ name: 'example', version: '1.0.0', description: 'An example plugin', detail: 'user · v1.0.0', status: 'ENABLED', scope: 'user' }]);
    mocks.execute.mockReset().mockResolvedValue('');
    mocks.detail.mockReset().mockResolvedValue({ plugin: { name: 'example', version: '1.0.0', description: 'An example plugin', scope: 'user', status: 'ENABLED' }, contributions: [{ kind: 'skill', name: 'example:review', sourceName: 'review', description: 'Review code', status: 'ENABLED' }] });
    window.lotagate = { extensions: { readPluginIcon: vi.fn().mockResolvedValue(undefined), resolvePublicPluginSource: vi.fn().mockResolvedValue('C:\\public-plugins\\workspace-review'), readDetail: vi.fn().mockResolvedValue({ content: '---\nname: review\ndescription: Review\n---\n', format: 'markdown', editable: false, fileName: 'SKILL.md' }), readPublicPluginContribution: vi.fn().mockResolvedValue({ content: '---\nname: review-workspace\ndescription: Review\n---\n', format: 'markdown', editable: false, fileName: 'SKILL.md' }), listProjectHooks: vi.fn() } } as unknown as typeof window.lotagate;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps Public and Personal tabs and renders installed plugins as cards without contribution toggles', async () => {
    render(<ToastProvider><PluginsPage cwd={'C:\\workspace'} /></ToastProvider>);
    expect(screen.getByRole('tab', { name: 'Public' })).toBeVisible();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Personal' }));
    expect(await screen.findByText('example')).toBeVisible();
    expect(screen.getByText('Installed')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders curated Public plugins and resolves their packaged source before install', async () => {
    render(<ToastProvider><PluginsPage cwd={'C:\\workspace'} /></ToastProvider>);
    expect(await screen.findByText('workspace-review')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Install' })[0]!);
    await waitFor(() => expect(window.lotagate.extensions.resolvePublicPluginSource).toHaveBeenCalledWith('workspace-review'));
    expect(mocks.execute).toHaveBeenCalledWith('C:\\workspace', { actionId: 'plugin.install', positionals: ['C:\\public-plugins\\workspace-review'], options: { scope: 'user' } });
  });

  it('renders contribution summaries for an uninstalled Public plugin before showing its install action', async () => {
    render(<ToastProvider><PluginsPage cwd={'C:\\workspace'} /></ToastProvider>);
    fireEvent.click(await screen.findByText('workspace-review'));
    expect(await screen.findByRole('heading', { name: 'Skills' })).toBeVisible();
    expect(screen.getByText('Agents')).toBeVisible();
    expect(screen.getByRole('button', { name: /install/i })).toBeVisible();
    expect(screen.queryByText('Back to plugins')).not.toBeInTheDocument();
    expect(screen.getByText('Information')).toBeVisible();
    expect(screen.getByText('Developer')).toBeVisible();
    expect(screen.getByRole('link', { name: /Website:/i })).toHaveAttribute('href', 'https://lotagate.com/');
    expect(screen.getByRole('link', { name: /Privacy Policy:/i })).toHaveAttribute('href', 'https://lotagate.com/privacy');
    expect(screen.getByRole('link', { name: /Terms of Service:/i })).toHaveAttribute('href', 'https://lotagate.com/terms');
    expect(mocks.detail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /review-workspace/i }));
    await waitFor(() => expect(window.lotagate.extensions.readPublicPluginContribution).toHaveBeenCalledWith({ pluginName: 'workspace-review', kind: 'skill', sourceName: 'review-workspace' }));
    expect(await screen.findByText('SKILL.md')).toBeVisible();
  });

  it('keeps the Public plugin detail open after installation', async () => {
    mocks.detail.mockResolvedValue({ plugin: { name: 'workspace-review', version: '1.0.0', description: 'Review workspaces', scope: 'user', status: 'ENABLED' }, contributions: [] });
    render(<ToastProvider><PluginsPage cwd={'C:\\workspace'} /></ToastProvider>);
    fireEvent.click(await screen.findByText('workspace-review'));
    fireEvent.click(screen.getByRole('button', { name: /install/i }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith('C:\\workspace', { actionId: 'plugin.install', positionals: ['C:\\public-plugins\\workspace-review'], options: { scope: 'user' } }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Plugin actions' }), { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: /uninstall plugin/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'workspace-review', hidden: true })).toBeInTheDocument();
  });

  it('shows Personal plugins in pages of up to 40 items', async () => {
    mocks.list.mockResolvedValue(Array.from({ length: 41 }, (_, index) => ({ name: `plugin-${index + 1}`, version: '1.0.0', description: `Plugin ${index + 1}`, detail: 'user · v1.0.0', status: 'ENABLED', scope: 'user' })));
    render(<ToastProvider><PluginsPage cwd="C:\\workspace" /></ToastProvider>);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Personal' }));
    expect(await screen.findByText('plugin-1')).toBeVisible();
    expect(screen.queryByText('plugin-41')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(await screen.findByText('plugin-41')).toBeVisible();
  });

  it('opens the read-only plugin detail and contribution preview', async () => {
    render(<ToastProvider><PluginsPage cwd="C:\\workspace" /></ToastProvider>);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Personal' }));
    fireEvent.click(await screen.findByText('example'));
    expect(await screen.findByRole('heading', { name: 'Skills' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    await waitFor(() => expect(window.lotagate.extensions.readDetail).toHaveBeenCalled());
    expect(await screen.findByText('SKILL.md')).toBeVisible();
  });
});
