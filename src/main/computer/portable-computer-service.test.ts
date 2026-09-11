import { describe, expect, it } from 'vitest';
import { PortableComputerService } from './portable-computer-service.js';

describe('PortableComputerService', () => {
  it('executes a bounded text clipboard provider without a shell', async () => {
    const service = new PortableComputerService({
      platform: process.platform === 'darwin' ? 'darwin' : 'linux',
      clipboardRead: { command: process.execPath, args: ['-e', 'process.stdout.write("portable clipboard")'] },
    }, async () => []);
    await expect(service.execute('computer.readClipboard', {})).resolves.toEqual({ text: 'portable clipboard' });
    expect(service.capabilities.operations).toContain('computer.readClipboard');
    expect(service.capabilities.operations).not.toContain('computer.wait');
  });

  it('does not advertise window-bound capture without window geometry support', () => {
    const service = new PortableComputerService({
      platform: 'linux',
      screenshot: { command: 'capture', args: path => [path] },
      ocr: 'tesseract',
    }, async () => []);
    expect(service.capabilities.operations).not.toContain('computer.screenshot');
    expect(service.capabilities.operations).not.toContain('computer.recognizeText');
  });
});
