import { describe, expect, it } from 'vitest';
import { settingsSchema } from './settings-service.js';

describe('sandbox settings migration', () => {
  it('migrates the removed guest allowlist to isolated networking and drops its domains', () => {
    const settings = settingsSchema.parse({ sandbox: { networkPolicy: 'allowlist', allowedDomains: ['example.com'] } });
    expect(settings.sandbox.networkPolicy).toBe('none');
    expect('allowedDomains' in settings.sandbox).toBe(false);
  });
});
