// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui.js';
import { ApiKeyPromptModal } from './ApiKeyPromptModal.js';

const commandMocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../../services/desktop-command-client.js', () => ({
  executeDesktopCommandResult: commandMocks.execute,
}));

describe('ApiKeyPromptModal', () => {
  beforeEach(() => commandMocks.execute.mockReset().mockResolvedValue({ content: '' }));
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('saves the key through the command protocol, shows a toast, and closes', async () => {
    const onSaved = vi.fn();
    render(<ToastProvider><ApiKeyPromptModal cwd="C:\workspace" onClose={vi.fn()} onSaved={onSaved} /></ToastProvider>);

    fireEvent.change(screen.getByPlaceholderText('Paste your API key'), { target: { value: 'sk-prompt-secret-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(commandMocks.execute).toHaveBeenCalledWith('C:\\workspace', expect.objectContaining({
      actionId: 'auth.login.direct',
      positionals: [],
      options: {},
      secrets: { apiKey: 'sk-prompt-secret-1234' },
    })));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByText('API key saved')).toBeVisible();
  });
});
