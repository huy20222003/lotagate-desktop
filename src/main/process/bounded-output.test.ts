import { describe, expect, it } from 'vitest';
import { BoundedOutputCollector } from './bounded-output.js';

describe('BoundedOutputCollector', () => {
  it('preserves UTF-8 characters split across process chunks', () => {
    const collector = new BoundedOutputCollector(4);
    collector.append('stdout', Buffer.from([0xf0, 0x9f]));
    collector.append('stdout', Buffer.from([0x98, 0x80]));
    collector.finish();
    expect(collector.value()).toEqual({ stdout: '😀', stderr: '', truncated: false });
  });

  it('truncates on a valid UTF-8 boundary using the shared byte budget', () => {
    const collector = new BoundedOutputCollector(4);
    collector.append('stdout', '😀a');
    expect(collector.value()).toEqual({ stdout: '😀', stderr: '', truncated: true });
  });
});
