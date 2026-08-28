// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    ['profile', 'Profile'], ['billing', 'Billing'], ['appearance', 'Appearance'], ['keyboard-shortcuts', 'Keyboard shortcuts'],
    ['automation', 'Automations'], ['browser', 'Browser'], ['sandbox', 'Sandbox'], ['hook', 'Hooks'], ['skill', 'Skills'], ['plugin', 'Plugins'], ['mcp', 'MCP'],
  ] as Array<[SettingsSection, string]> )('routes the %s settings section', async (section, title) => {
    installBridge();
    render(<ToastProvider><SettingsPage user={user} workspaces={[]} onBack={vi.fn()} keyboardShortcuts={{}} onUpdateShortcut={vi.fn().mockResolvedValue(undefined)} initialSection={section} /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole('heading', { name: title, level: 1 })).toBeVisible());
  });

  it('saves Browser and Sandbox changes through the shared settings bridge', async () => {
    const update = installBridge();
    const view = render(<ToastProvider><SettingsPage user={user} workspaces={[]} onBack={vi.fn()} keyboardShortcuts={{}} onUpdateShortcut={vi.fn().mockResolvedValue(undefined)} initialSection="browser" /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ browser }));

    view.unmount();
    render(<ToastProvider><SettingsPage user={user} workspaces={[]} onBack={vi.fn()} keyboardShortcuts={{}} onUpdateShortcut={vi.fn().mockResolvedValue(undefined)} initialSection="sandbox" /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ sandbox }));
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
  } as unknown as typeof window.lotagate;
  return update;
}

function baseSettings() { return { appearance: 'system', language: 'en', reducedMotion: false, contrast: 60, uiFont: 'inter', codeFont: 'system', browser, sandbox, keyboardShortcuts: {} }; }
