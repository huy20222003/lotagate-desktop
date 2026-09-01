import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  supported: true,
  show: vi.fn(),
  options: undefined as { title?: string; body?: string } | undefined,
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
  Notification: class {
    static isSupported(): boolean { return mocks.supported; }
    constructor(options: { title?: string; body?: string }) { mocks.options = options; }
    show(): void { mocks.show(); }
  },
}));

import { DesktopNotificationService } from './desktop-notification-service.js';

describe('DesktopNotificationService', () => {
  beforeEach(() => {
    mocks.supported = true;
    mocks.options = undefined;
    mocks.show.mockReset();
  });

  it('keeps the OS header identity and clamps the notification body', () => {
    new DesktopNotificationService().notify({ title: 'LotaGate', body: 'x'.repeat(300) });

    expect(mocks.options).toEqual({
      title: 'LotaGate',
      body: `${'x'.repeat(240)}....`,
    });
    expect(mocks.show).toHaveBeenCalledOnce();
  });

  it('does not create a notification when the platform is unsupported', () => {
    mocks.supported = false;

    new DesktopNotificationService().notify({ title: 'LotaGate', body: 'Ready' });

    expect(mocks.options).toBeUndefined();
    expect(mocks.show).not.toHaveBeenCalled();
  });
});
