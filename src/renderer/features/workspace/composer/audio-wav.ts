const TARGET_SAMPLE_RATE = 16_000;

export async function recordingToWav(blob: Blob): Promise<Uint8Array> {
  const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioContextConstructor === undefined) throw new Error('Audio decoding is not supported by this app environment.');
  const context = new AudioContextConstructor();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    return encodePcm16Wav(resampleMono(decoded), TARGET_SAMPLE_RATE);
  } finally {
    await context.close();
  }
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff)), true));
  return new Uint8Array(buffer);
}

function resampleMono(audio: AudioBuffer): Float32Array {
  const sourceLength = audio.length;
  const targetLength = Math.max(1, Math.round(sourceLength * TARGET_SAMPLE_RATE / audio.sampleRate));
  const samples = new Float32Array(targetLength);
  const channels = audio.numberOfChannels;
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * audio.sampleRate / TARGET_SAMPLE_RATE;
    const left = Math.floor(sourcePosition);
    const right = Math.min(sourceLength - 1, left + 1);
    const weight = sourcePosition - left;
    let sample = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const data = audio.getChannelData(channel);
      sample += (data[left] ?? 0) * (1 - weight) + (data[right] ?? 0) * weight;
    }
    samples[index] = sample / Math.max(1, channels);
  }
  return samples;
}

function writeAscii(view: DataView, offset: number, value: string): void { [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0))); }
