// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '../../../contracts/ipc/v1/auth.js';
import { ToastProvider } from '../../components/ui.js';
import { SettingsPage, type SettingsSection } from './SettingsPage.js';

const user: UserProfile = { id: 'user-1', email: 'user@example.test', fullName: 'Test User', defaultOrganizationCode: 'org-1', organizations: [{ id: 'org-1', organizationCode: 'org-1', displayName: 'Test Org', role: 'Member', workspaces: [] }] };
const browser = { viewportProfile: 'desktop', customViewport: { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 }, downloadDirectory: '', sessionRetention: 'persistent', sessionRetentionMinutes: 60, originAllowlist: [], clearDataOnClose: false, evidenceRetentionDays: 30 };
const sandbox = { backend: 'auto', image: 'node:22-bookworm-slim', networkPolicy: 'none', mountMode: 'read-write', memoryMb: 2_048, cpuCores: 2, pidsLimit: 128, hostFallback: 'ask', cleanup: 'always', diagnosticsRetentionDays: 30 };

describe('SettingsPage', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it.each([
    ['general', 'General'], ['profile', 'Profile'], ['api-key', 'API key'], ['billing', 'Billing'], ['appearance', 'Appearance'], ['keyboard-shortcuts', 'Keyboard shortcuts'],
    ['browser', 'Browser'], ['sandbox', 'Sandbox'], ['memory', 'Memory'], ['about', 'About'], ['hook', 'Hooks'], ['skill', 'Skills'], ['plugin', 'Plugins'], ['mcp', 'MCP'],
  ] as Array<[SettingsSection, string]> )('routes the %s settings section', async (section, title) => {
    installBridge();
    render(<ToastProvider><SettingsPage user={user} onBack={vi.fn()} keyboardShortcuts={{}} onUpdateShortcut={vi.fn().mockResolvedValue(undefined)} initialSection={section} /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole('heading', { name: title, level: 1 })).toBeVisible());
  });

  it('saves Browser and Sandbox changes immediately through the shared settings bridge', async () => {
    const update = installBridge();
    const view = render(<ToastProvider><SettingsPage user={user} onBack={vi.fn()} keyboardShortcuts={{}} onUpdateShortcut={vi.fn().mockResolvedValue(undefined)} initialSection="browser" /></ToastProvider>);
    const downloadDirectory = await screen.findByPlaceholderText('Default: system Downloads/LotaGate Browser');
    fireEvent.change(downloadDirectory, { target: { value: 'C:/downloads' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ browser: { ...browser, downloadDirectory: 'C:/downloads' } }));

    view.unmount();
    render(<ToastProvider><SettingsPage user={user} onBack={vi.fn()} keyboardShortcuts={{}} onUpdateShortcut={vi.fn().mockResolvedValue(undefined)} initialSection="sandbox" /></ToastProvider>);
    const memory = await screen.findByRole('spinbutton', { name: 'Memory limit (MB)' });
    fireEvent.change(memory, { target: { value: '4096' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ sandbox: { ...sandbox, memoryMb: 4096 } }));
  });

  it('shows a shared success toast after checking for updates', async () => {
    installBridge();
    render(<ToastProvider><SettingsPage user={user} onBack={vi.fn()} keyboardShortcuts={{}} onUpdateShortcut={vi.fn().mockResolvedValue(undefined)} initialSection="about" /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('You are up to date'));
  });

  it('navigates to the Settings parent from the breadcrumb', async () => {
    installBridge();
    render(<ToastProvider><SettingsPage user={user} onBack={vi.fn()} keyboardShortcuts={{}} onUpdateShortcut={vi.fn().mockResolvedValue(undefined)} initialSection="skill" /></ToastProvider>);
    expect(await screen.findByRole('heading', { name: 'Skills', level: 1 })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    expect(await screen.findByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
  });

  it('returns from plugin detail to the Plugins list through the breadcrumb', async () => {
    installBridge();
    render(<ToastProvider><SettingsPage user={user} onBack={vi.fn()} keyboardShortcuts={{}} onUpdateShortcut={vi.fn().mockResolvedValue(undefined)} initialSection="plugin" /></ToastProvider>);
    fireEvent.click(await screen.findByText('workspace-review'));
    expect(await screen.findByRole('heading', { name: 'workspace-review', level: 1 })).toBeVisible();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Plugins' }));
    expect(await screen.findByRole('heading', { name: 'Plugins', level: 1 })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'workspace-review', level: 1 })).not.toBeInTheDocument();
  });
});

function installBridge() {
  const update = vi.fn((patch: Record<string, unknown>) => Promise.resolve({ ...baseSettings(), ...patch }));
  window.lotagate = {
    settings: { get: vi.fn().mockResolvedValue(baseSettings()), update },
    userContext: { usage: vi.fn().mockResolvedValue([]), dashboardStats: vi.fn().mockResolvedValue({}), wallet: vi.fn().mockResolvedValue(null), paymentHistory: vi.fn().mockResolvedValue({ data: [], total: 0 }) },
    workspaces: { list: vi.fn().mockResolvedValue([]) },
    tasks: { list: vi.fn().mockResolvedValue([]), activities: vi.fn().mockResolvedValue([]) },
    automations: { list: vi.fn().mockResolvedValue([]), onState: vi.fn(() => () => {}) },
    updates: { getInfo: vi.fn().mockResolvedValue({ productName: 'LotaGate Desktop', applicationId: 'com.lotagate.desktop', version: '0.1.0', cliVersion: '0.1.24', electronVersion: '44.0.0', nodeVersion: '22.0.0', platform: 'WINDOWS', architecture: 'X64', updateChannel: 'STABLE', packaged: false }), getState: vi.fn().mockResolvedValue({ phase: 'disabled', currentVersion: '0.1.0', platform: 'WINDOWS', architecture: 'X64', release: null, asset: null, blocking: false, bytesDownloaded: 0, totalBytes: null, downloadedFileName: null, error: null }), check: vi.fn().mockResolvedValue({ phase: 'up-to-date', currentVersion: '0.1.0', platform: 'WINDOWS', architecture: 'X64', release: null, asset: null, blocking: false, bytesDownloaded: 0, totalBytes: null, downloadedFileName: null, error: null }), download: vi.fn(), cancel: vi.fn(), install: vi.fn(), onState: vi.fn(() => () => {}) },
  } as unknown as typeof window.lotagate;
  return update;
}

function baseSettings() { return { appearance: 'system', language: 'en', reducedMotion: false, contrast: 60, uiFont: 'inter', codeFont: 'system', browser, sandbox, keyboardShortcuts: {}, terminalShell: 'powershell', terminalPlacement: 'bottom', terminalFontSize: 13, terminalScrollback: 10_000, terminalCursorBlink: true }; }
