export type RemoteSlashCommandId = 'goal.run' | 'image.generate' | 'image.edit' | 'video.generate' | 'audio.speech' | 'audio.transcribe' | 'audio.translate';
export type RemoteSlashFieldType = 'text' | 'textarea' | 'select' | 'directory' | 'file' | 'multiple-file' | 'checkbox';
export type RemoteSlashModelCategory = 'image' | 'video' | 'speech' | 'translation' | 'transcription';

export interface RemoteSlashCommandField {
  name: string;
  label: string;
  type: RemoteSlashFieldType;
  placeholder?: string;
  options?: string[];
  accept?: string[];
  required?: boolean;
  maxBytes?: number;
  maxTotalBytes?: number;
  maxFiles?: number;
  validation?: RemoteSlashFieldValidation;
}

export interface RemoteSlashFieldValidation {
  maxLength?: number;
  integer?: { min: number; max: number };
  number?: { min: number; max: number };
  jsonObject?: boolean;
  outputName?: boolean;
  imageSize?: boolean;
  csvAllowed?: string[];
}

export interface RemoteSlashValidationCondition {
  field: string;
  operator: 'has-value' | 'equals' | 'greater-than';
  value?: string | number | boolean;
}

export interface RemoteSlashValidationRule {
  type: 'requires' | 'requires-option' | 'conflicts';
  when: RemoteSlashValidationCondition;
  field: string;
  values?: string[];
  message: string;
}

export interface RemoteSlashCommandValidation {
  primaryMaxLength?: number;
  fields?: Record<string, RemoteSlashFieldValidation>;
  rules?: RemoteSlashValidationRule[];
}

export interface RemoteSlashCommandDefinition {
  id: RemoteSlashCommandId;
  label: string;
  description: string;
  modelCategory?: RemoteSlashModelCategory;
  primaryLabel: string;
  primaryPlaceholder: string;
  primaryRequired?: boolean;
  fields: RemoteSlashCommandField[];
  advancedFields: RemoteSlashCommandField[];
  validation?: RemoteSlashCommandValidation;
}

const OUTPUT_FIELDS: RemoteSlashCommandField[] = [
  { name: 'model', label: 'Model', type: 'select' },
  { name: 'out', label: 'Output filename', type: 'text', placeholder: 'Optional filename without extension' },
  { name: 'out-dir', label: 'Output directory', type: 'directory', placeholder: 'Optional local directory' },
  { name: 'force', label: 'Overwrite existing output', type: 'checkbox' },
];
const AUDIO_FILE_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm', 'mp4', 'mpeg', 'mpga', 'oga'];
const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const IMAGE_FIELDS: RemoteSlashCommandField[] = [
  { name: 'n', label: 'Number of images', type: 'text', placeholder: '1' },
  { name: 'size', label: 'Size', type: 'select', options: ['auto', '1024x1024', '1536x1024', '1024x1536'] },
  { name: 'quality', label: 'Quality', type: 'select', options: ['auto', 'low', 'medium', 'high'] },
  { name: 'background', label: 'Background', type: 'select', options: ['auto', 'transparent', 'opaque'] },
  { name: 'output-format', label: 'Output format', type: 'select', options: ['png', 'jpeg', 'webp'] },
];
const IMAGE_ADVANCED_FIELDS: RemoteSlashCommandField[] = [
  { name: 'output-compression', label: 'Compression', type: 'text', placeholder: 'Optional 0-100' },
  { name: 'moderation', label: 'Moderation', type: 'text', placeholder: 'Optional policy' },
  { name: 'user', label: 'User identifier', type: 'text', placeholder: 'Optional identifier' },
  ...OUTPUT_FIELDS,
];

export const REMOTE_SLASH_COMMAND_DEFINITIONS: RemoteSlashCommandDefinition[] = [
  { id: 'goal.run', label: 'Goal', description: 'Run a focused autonomous goal.', primaryLabel: 'Objective', primaryPlaceholder: 'What should the agent accomplish?', validation: { primaryMaxLength: 16_384, fields: { 'token-budget': { integer: { min: 1, max: 10_000_000 } }, 'max-turns': { integer: { min: 1, max: 10_000 } }, 'max-duration-ms': { integer: { min: 1, max: 8 * 60 * 60 * 1_000 } } } }, fields: [{ name: 'token-budget', label: 'Token budget', type: 'text', placeholder: 'Optional number' }, { name: 'max-turns', label: 'Maximum turns', type: 'text', placeholder: 'Optional number' }, { name: 'max-duration-ms', label: 'Maximum duration (ms)', type: 'text', placeholder: 'Optional number' }], advancedFields: [] },
  { id: 'image.generate', label: 'Image', description: 'Generate an image from a prompt.', modelCategory: 'image', primaryLabel: 'Prompt', primaryPlaceholder: 'Describe the image to generate', validation: imageValidation(), fields: IMAGE_FIELDS, advancedFields: IMAGE_ADVANCED_FIELDS },
  { id: 'image.edit', label: 'Image edit', description: 'Edit one or more workspace images.', modelCategory: 'image', primaryLabel: 'Prompt', primaryPlaceholder: 'Describe how to edit the image', validation: imageValidation(), fields: [{ name: 'image', label: 'Source image(s)', type: 'multiple-file', accept: IMAGE_FILE_EXTENSIONS, required: true, maxBytes: 47 * 1_000_000, maxTotalBytes: 128 * 1_000_000, maxFiles: 16 }, { name: 'mask', label: 'Mask image', type: 'file', accept: IMAGE_FILE_EXTENSIONS, maxBytes: 4 * 1_000_000 }, { name: 'input-fidelity', label: 'Input fidelity', type: 'select', options: ['low', 'high'] }], advancedFields: [...IMAGE_FIELDS, ...IMAGE_ADVANCED_FIELDS] },
  { id: 'video.generate', label: 'Video', description: 'Generate a video from a prompt.', modelCategory: 'video', primaryLabel: 'Prompt', primaryPlaceholder: 'Describe the video to generate', validation: { primaryMaxLength: 16_384, fields: { parameters: { jsonObject: true }, out: { outputName: true } }, rules: outputRules() }, fields: [{ name: 'parameters', label: 'Parameters (JSON)', type: 'textarea', placeholder: '{ }' }, { name: 'no-wait', label: 'Return before completion', type: 'checkbox' }], advancedFields: OUTPUT_FIELDS },
  { id: 'audio.speech', label: 'Audio', description: 'Convert text into speech.', modelCategory: 'speech', primaryLabel: 'Text', primaryPlaceholder: 'Text to synthesize', validation: { primaryMaxLength: 4_096, fields: { voice: { maxLength: 64 }, instructions: { maxLength: 4_096 }, speed: { number: { min: 0.25, max: 4 } }, out: { outputName: true } }, rules: outputRules() }, fields: [{ name: 'voice', label: 'Voice', type: 'text', placeholder: 'Voice name', required: true }, { name: 'instructions', label: 'Instructions', type: 'textarea', placeholder: 'Optional speaking instructions' }, { name: 'response-format', label: 'Response format', type: 'select', options: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] }, { name: 'stream-format', label: 'Stream format', type: 'select', options: ['audio', 'sse'] }, { name: 'speed', label: 'Speed', type: 'text', placeholder: '1.0' }], advancedFields: OUTPUT_FIELDS },
  { id: 'audio.transcribe', label: 'Audio transcribe', description: 'Transcribe an audio file.', modelCategory: 'transcription', primaryLabel: 'Prompt (optional)', primaryPlaceholder: 'Optional transcription prompt', primaryRequired: false, validation: audioValidation(), fields: [{ name: 'file', label: 'Audio file', type: 'file', accept: AUDIO_FILE_EXTENSIONS, required: true, maxBytes: 50 * 1_000_000 }, { name: 'language', label: 'Language code', type: 'text', placeholder: 'Optional language code' }, { name: 'response-format', label: 'Response format', type: 'select', options: ['json', 'text', 'srt', 'verbose_json', 'vtt', 'diarized_json'] }, { name: 'temperature', label: 'Temperature', type: 'text', placeholder: '0.0 - 1.0' }, { name: 'timestamp-granularities', label: 'Timestamp granularities', type: 'text', placeholder: 'word,segment' }, { name: 'include', label: 'Include fields', type: 'text', placeholder: 'Optional comma-separated fields' }], advancedFields: [...OUTPUT_FIELDS] },
  { id: 'audio.translate', label: 'Audio translate', description: 'Translate an audio file.', modelCategory: 'translation', primaryLabel: 'Prompt (optional)', primaryPlaceholder: 'Optional translation prompt', primaryRequired: false, validation: audioValidation(), fields: [{ name: 'file', label: 'Audio file', type: 'file', accept: AUDIO_FILE_EXTENSIONS, required: true, maxBytes: 50 * 1_000_000 }, { name: 'response-format', label: 'Response format', type: 'select', options: ['json', 'text', 'srt', 'verbose_json', 'vtt'] }, { name: 'temperature', label: 'Temperature', type: 'text', placeholder: '0.0 - 1.0' }], advancedFields: OUTPUT_FIELDS },
];

function outputRules(): RemoteSlashValidationRule[] {
  return [
    { type: 'requires', when: { field: 'force', operator: 'equals', value: true }, field: 'out', message: 'Overwrite requires an output filename.' },
    { type: 'conflicts', when: { field: 'no-wait', operator: 'equals', value: true }, field: 'out', message: 'Return before completion cannot be combined with output options.' },
    { type: 'conflicts', when: { field: 'no-wait', operator: 'equals', value: true }, field: 'out-dir', message: 'Return before completion cannot be combined with output options.' },
    { type: 'conflicts', when: { field: 'no-wait', operator: 'equals', value: true }, field: 'force', message: 'Return before completion cannot be combined with output options.' },
  ];
}

function imageValidation(): RemoteSlashCommandValidation {
  return {
    primaryMaxLength: 32_000,
    fields: { n: { integer: { min: 1, max: 16 } }, size: { imageSize: true }, 'output-compression': { integer: { min: 0, max: 100 } }, moderation: { maxLength: 64 }, user: { maxLength: 255 }, out: { outputName: true } },
    rules: [...outputRules(), { type: 'requires-option', when: { field: 'output-compression', operator: 'has-value' }, field: 'output-format', values: ['jpeg', 'webp'], message: 'Compression requires JPEG or WebP output format.' }, { type: 'conflicts', when: { field: 'n', operator: 'greater-than', value: 1 }, field: 'out', message: 'Output filename can only be used for one image.' }],
  };
}

function audioValidation(): RemoteSlashCommandValidation {
  return { primaryMaxLength: 4_096, fields: { language: { maxLength: 10 }, temperature: { number: { min: 0, max: 1 } }, 'timestamp-granularities': { csvAllowed: ['word', 'segment'] }, out: { outputName: true } }, rules: [...outputRules(), { type: 'requires-option', when: { field: 'timestamp-granularities', operator: 'has-value' }, field: 'response-format', values: ['verbose_json'], message: 'Timestamp granularities require verbose_json response format.' }] };
}
