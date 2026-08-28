import { describe, expect, it } from 'vitest';
import { parseMediaCommandResult } from './media-command-result.js';

describe('parseMediaCommandResult', () => {
  it('accepts only the media type allowed by the command action', () => {
    expect(parseMediaCommandResult({ kind: 'media', mediaType: 'image', artifacts: [{ path: 'C:\\image.png' }] }, 'image.generate')).toEqual({ mediaType: 'image', paths: ['C:\\image.png'] });
    expect(parseMediaCommandResult({ kind: 'media', mediaType: 'audio', artifacts: [{ path: 'C:\\speech.mp3' }] }, 'image.generate')).toBeUndefined();
  });

  it('rejects malformed or unsafe paths', () => {
    expect(parseMediaCommandResult({ kind: 'media', mediaType: 'video', artifacts: [{ path: '' }] }, 'video.generate')).toBeUndefined();
    expect(parseMediaCommandResult({ kind: 'media', mediaType: 'video', artifacts: [{ path: 'C:\\video\0.mp4' }] }, 'video.generate')).toBeUndefined();
    expect(parseMediaCommandResult({ kind: 'media', mediaType: 'video', artifacts: [] }, 'video.generate')).toBeUndefined();
  });
});
