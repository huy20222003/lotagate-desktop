// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/ui.js';
import { RemoteControlPage } from './RemoteControlPage.js';

describe('RemoteControlPage', () => {
  it('creates a temporary session through the typed Desktop bridge', async () => {
    const create = vi.fn().mockResolvedValue({ sessionId: '2e4b7c4b-7138-4b85-9b0a-7a2cfc5d4d43', connectUrl: 'http://127.0.0.1:8787/connect#session=demo&token=pairing', expiresAt: '2026-09-02T13:00:00.000Z', status: 'connecting' });
    window.lotagate = {
      remoteControl: { get: vi.fn().mockResolvedValue(null), create, revoke: vi.fn(), onState: vi.fn(() => () => undefined) },
    } as unknown as typeof window.lotagate;

    render(<ToastProvider><RemoteControlPage /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Create remote session' }));

    expect(create).toHaveBeenCalledOnce();
    expect(await screen.findByAltText('Scan to connect to LotaGate Desktop Remote Control')).toBeInTheDocument();
  });
});
