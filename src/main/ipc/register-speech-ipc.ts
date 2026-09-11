import { assertTrustedRenderer } from './sender-policy.js';
import { speechAudioSchema, speechLanguageSchema, speechSynthesisInputSchema } from '../../contracts/ipc/v1/speech.js';
import type { IpcRegistrationContext } from './ipc-registration-context.js';

export function registerSpeechIpcHandlers(context: IpcRegistrationContext): void {
  const { handle, speech, agents, requireWorkspaceCwd } = context;
  handle('speech.transcribe', async (event, audio: unknown, language?: unknown) => {
    assertTrustedRenderer(event);
    return speech.transcribe(speechAudioSchema.parse(audio), speechLanguageSchema.parse(language));
  });
  handle('speech.synthesize', async (event, cwd: unknown, input: unknown) => {
    assertTrustedRenderer(event);
    return agents.speechSynthesize(await requireWorkspaceCwd(cwd), speechSynthesisInputSchema.parse(input));
  });
}
