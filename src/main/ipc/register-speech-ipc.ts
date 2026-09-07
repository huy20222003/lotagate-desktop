import { assertTrustedRenderer } from './sender-policy.js';
import { speechAudioSchema, speechLanguageSchema } from '../../contracts/ipc/v1/speech.js';
import type { IpcRegistrationContext } from './ipc-registration-context.js';

export function registerSpeechIpcHandlers(context: IpcRegistrationContext): void {
  const { handle, speech } = context;
  handle('speech.transcribe', async (event, audio: unknown, language?: unknown) => {
    assertTrustedRenderer(event);
    return speech.transcribe(speechAudioSchema.parse(audio), speechLanguageSchema.parse(language));
  });
}
