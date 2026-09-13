import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { VmGuestBridge, VmGuestProcessError } from './vm-guest-bridge.js';

function fakeChild(): { child: ChildProcessWithoutNullStreams; input: PassThrough; output: PassThrough } {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  Object.assign(child, { stdin: input, stdout: output, stderr: error, pid: undefined, exitCode: null, signalCode: null, kill: () => true });
  return { child, input, output };
}

describe('VmGuestBridge', () => {
  it('accepts multiple valid responses delivered in one oversized chunk', async () => {
    const fake = fakeChild();
    const bridge = new VmGuestBridge(fake.child, 'token', 220);
    let wire = '';
    fake.input.on('data', chunk => { wire += chunk.toString('utf8'); });

    const first = bridge.execute({ action: 'filesystem.read', params: {} });
    const second = bridge.execute({ action: 'filesystem.list', params: {} });
    await new Promise<void>(resolve => setImmediate(resolve));
    const requests = wire.trim().split('\n').map(line => JSON.parse(line) as { requestId: string });
    const response = requests.map(request => JSON.stringify({ requestId: request.requestId, ok: true, result: 'x'.repeat(80) })).join('\n');
    expect(response.length).toBeGreaterThan(220);
    fake.output.write(`${response}\n`);

    await expect(first).resolves.toMatchObject({ result: 'x'.repeat(80) });
    await expect(second).resolves.toMatchObject({ result: 'x'.repeat(80) });
    await bridge.close();
  });

  it('rejects pending requests with a typed process error when the guest exits unexpectedly', async () => {
    const fake = fakeChild();
    const bridge = new VmGuestBridge(fake.child, 'token');
    const request = bridge.execute({ action: 'health', params: {} });
    fake.child.emit('error', new Error('spawn failed'));
    await expect(request).rejects.toBeInstanceOf(VmGuestProcessError);
    await bridge.close();
  });
});
