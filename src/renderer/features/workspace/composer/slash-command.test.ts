import { describe, expect, it } from 'vitest';
import { availableSlashCommands, createSlashCommandForm, createSlashInvocation, filterSlashCommands, modelsForSlashCommand, slashCommandLabel, SLASH_COMMAND_DEFINITIONS, validateSlashCommandForm } from './slash-command.js';

describe('slash commands', () => {
  it('only exposes commands advertised by the CLI catalog', () => {
    const commands = availableSlashCommands([{ id: 'image.generate', path: ['image', 'generate'], summary: 'Generate image' }]);
    expect(commands.map(command => command.id)).toEqual(['image.generate']);
  });

  it('includes all media command variants exposed by the CLI', () => {
    const commands = availableSlashCommands([
      { id: 'image.generate', path: ['image'], summary: 'Generate' },
      { id: 'image.edit', path: ['image', 'edit'], summary: 'Edit' },
      { id: 'audio.speech', path: ['audio', 'speech'], summary: 'Speech' },
      { id: 'audio.transcribe', path: ['audio', 'transcribe'], summary: 'Transcribe' },
      { id: 'audio.translate', path: ['audio', 'translate'], summary: 'Translate' },
      { id: 'video.generate', path: ['video'], summary: 'Video' },
    ]);
    expect(commands.map(command => command.id)).toEqual(['image.generate', 'image.edit', 'video.generate', 'audio.speech', 'audio.transcribe', 'audio.translate']);
  });

  it('initializes every dropdown with its first CLI-supported value', () => {
    const command = SLASH_COMMAND_DEFINITIONS.find(item => item.id === 'audio.transcribe')!;
    expect(createSlashCommandForm(command).values['response-format']).toBe('json');

    const speechCommand = SLASH_COMMAND_DEFINITIONS.find(item => item.id === 'audio.speech')!;
    expect(createSlashCommandForm(speechCommand).values['stream-format']).toBe('audio');
  });

  it('keeps model categories and selects the first compatible model', () => {
    const command = SLASH_COMMAND_DEFINITIONS.find(item => item.id === 'image.generate')!;
    const models = [
      { id: 'video-model', label: 'Video model', category: 'video' },
      { id: 'image-model', label: 'Image model', category: 'image' },
    ];
    expect(modelsForSlashCommand(command, models)).toEqual([models[1]]);
    expect(createSlashCommandForm(command, models).values['model']).toBe('image-model');
  });

  it('keeps the full command name in the picker while preserving the CLI action id', () => {
    const command = SLASH_COMMAND_DEFINITIONS.find(item => item.id === 'image.generate')!;
    expect(slashCommandLabel(command)).toBe('/image generate');
    expect(createSlashInvocation(command, { ...createSlashCommandForm(command), primary: 'a cat' }).actionId).toBe('image.generate');
  });

  it('filters the picker by command name', () => {
    const commands = filterSlashCommands(SLASH_COMMAND_DEFINITIONS, 'image.g');
    expect(commands.map(command => command.id)).toEqual(['image.generate']);
  });

  it('serializes form values into the existing command invocation shape', () => {
    const command = SLASH_COMMAND_DEFINITIONS.find(item => item.id === 'image.generate')!;
    const form = { ...createSlashCommandForm(), primary: 'a sunset', values: { size: '1024x1024', out: 'sunset', force: true } };
    expect(createSlashInvocation(command, form)).toEqual({ actionId: 'image.generate', positionals: ['a sunset'], options: { size: '1024x1024', out: 'sunset', force: true } });
  });

  it('serializes the speech stream format selected in the shared dropdown', () => {
    const command = SLASH_COMMAND_DEFINITIONS.find(item => item.id === 'audio.speech')!;
    const invocation = createSlashInvocation(command, {
      ...createSlashCommandForm(command),
      primary: 'hello',
      values: { voice: 'alloy', 'stream-format': 'sse' },
    });
    expect(invocation.options).toMatchObject({ voice: 'alloy', 'stream-format': 'sse' });
  });

  it('validates required command fields', () => {
    const command = SLASH_COMMAND_DEFINITIONS.find(item => item.id === 'audio.speech')!;
    expect(() => createSlashInvocation(command, { ...createSlashCommandForm(), primary: 'hello' })).toThrow('Voice is required.');
  });

  it('validates CLI media limits before creating an invocation', () => {
    const command = SLASH_COMMAND_DEFINITIONS.find(item => item.id === 'image.generate')!;
    const errors = validateSlashCommandForm(command, { ...createSlashCommandForm(command), primary: 'a'.repeat(32_001), values: { n: '17', size: '1000x1000', 'output-compression': '10', 'output-format': 'png' } });
    expect(errors.primary).toBeDefined();
    expect(errors.fields['n']).toContain('between 1 and 16');
    expect(errors.fields['output-compression']).toContain('JPEG or WebP');
  });

  it('maps optional audio transcription prompt to the CLI option', () => {
    const command = SLASH_COMMAND_DEFINITIONS.find(item => item.id === 'audio.transcribe')!;
    const invocation = createSlashInvocation(command, { ...createSlashCommandForm(command), primary: 'speaker names', values: { file: 'recording.mp3' } });
    expect(invocation.positionals).toEqual([]);
    expect(invocation.options).toMatchObject({ prompt: 'speaker names', file: 'recording.mp3' });
  });
});
