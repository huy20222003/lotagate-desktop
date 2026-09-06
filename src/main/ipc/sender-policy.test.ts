import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ app: { isPackaged: false, getAppPath: vi.fn(() => 'C:\\app') } }));
vi.mock('electron', () => ({ app: mocks.app }));

import { assertTrustedRenderer } from './sender-policy.js';

const originalRendererUrl = process.env['ELECTRON_RENDERER_URL'];

afterEach(() => {
  if (originalRendererUrl === undefined) delete process.env['ELECTRON_RENDERER_URL'];
  else process.env['ELECTRON_RENDERER_URL'] = originalRendererUrl;
  mocks.app.isPackaged = false;
});

describe('sender policy', () => {
  it('accepts only the configured development renderer origin and path', () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173/index.html';
    const frame = { url: 'http://localhost:5173/index.html' };
    const untrustedFrame = { url: 'http://localhost:5174/index.html' };

    expect(() => assertTrustedRenderer({ senderFrame: frame, sender: { mainFrame: frame } } as never)).not.toThrow();
    expect(() => assertTrustedRenderer({ senderFrame: untrustedFrame, sender: { mainFrame: untrustedFrame } } as never)).toThrow('Untrusted renderer');
  });

  it('rejects localhost renderer senders in packaged builds', () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173/index.html';
    mocks.app.isPackaged = true;
    const frame = { url: 'http://localhost:5173/index.html' };

    expect(() => assertTrustedRenderer({ senderFrame: frame, sender: { mainFrame: frame } } as never)).toThrow('Untrusted renderer');
  });
});
