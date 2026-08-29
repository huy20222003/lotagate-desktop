// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui.js';
import { ApiKeySettingsPage } from './ApiKeySettingsPage.js';

const commandMocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../../services/desktop-command-client.js', () => ({
  executeDesktopCommandResult: commandMocks.execute,
}));

describe('ApiKeySettingsPage', () => {
  let authenticated = false;

  beforeEach(() => {
    authenticated = false;
    commandMocks.execute.mockReset().mockImplementation(async (_cwd: string, invocation: { actionId: string }) => {
      if (invocation.actionId === 'auth.login.direct') authenticated = true;
      if (invocation.actionId === 'auth.logout') authenticated = false;
      return { content: invocation.actionId === 'auth.status' ? JSON.stringify({ authenticated }) : '' };
    });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('saves the default API key through the Desktop command protocol', async () => {
    render(<ToastProvider><ApiKeySettingsPage cwd="C:\workspace" /></ToastProvider>);

    await waitFor(() => expect(screen.getByText('Not configured')).toBeVisible());
    fireEvent.change(screen.getByPlaceholderText('Paste your API key'), { target: { value: 'sk-desktop-secret-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(commandMocks.execute).toHaveBeenCalledWith('C:\\workspace', expect.objectContaining({
      actionId: 'auth.login.direct',
      positionals: [],
      options: {},
      secrets: { apiKey: 'sk-desktop-secret-1234' },
    })));
    await waitFor(() => expect(screen.getByText('Configured')).toBeVisible());
  });

  it('confirms before removing the default API key', async () => {
    authenticated = true;
    render(<ToastProvider><ApiKeySettingsPage cwd="C:\workspace" /></ToastProvider>);

    await waitFor(() => expect(screen.getByText('Configured')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove the API key from the default CLI profile?')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!);

    await waitFor(() => expect(commandMocks.execute).toHaveBeenCalledWith('C:\\workspace', expect.objectContaining({ actionId: 'auth.logout', positionals: [], options: {} })));
  });
});
