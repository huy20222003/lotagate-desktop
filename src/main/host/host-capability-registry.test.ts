import { describe, expect, it } from 'vitest';
import { HostCapabilityRegistry, supportsHostCapability } from './host-capability-registry.js';

describe('HostCapabilityRegistry', () => {
  it('keeps one capability snapshot for computer and document providers', () => {
    const registry = new HostCapabilityRegistry({
      computer: { available: true, provider: 'test-computer', operations: ['computer.readClipboard'] },
      documents: { pdf: { available: true, provider: 'test-pdf', operations: ['pdf.open', 'pdf.validate'] } },
    });

    expect(registry.snapshot).toMatchObject({ computer: { provider: 'test-computer' }, documents: { pdf: { provider: 'test-pdf' } } });
    expect(registry.supportsComputer('computer.readClipboard')).toBe(true);
    expect(registry.supportsComputer('computer.click')).toBe(false);
    expect(registry.supportsDocument('pdf', 'pdf.validate')).toBe(true);
    expect(registry.supportsDocument('pdf', 'pdf.render')).toBe(false);
  });

  it('supports wildcard providers and preserves legacy undefined capabilities', () => {
    expect(supportsHostCapability({ available: true, provider: 'test', operations: ['*'] }, 'computer.click')).toBe(true);
    expect(supportsHostCapability(undefined, 'computer.click')).toBe(true);
    expect(supportsHostCapability({ available: false, provider: 'test', operations: ['*'], reason: 'Unavailable' }, 'computer.click')).toBe(false);
  });

  it('exposes provider reasons for unsupported operations', () => {
    const registry = new HostCapabilityRegistry({ computer: { available: false, provider: 'test', operations: [], reason: 'Install the native helper.' } });
    expect(registry.computerReason('computer.inspect')).toBe('Install the native helper.');
  });
});
