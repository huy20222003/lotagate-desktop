import type { DesktopCommandDescriptor, DesktopCommandInvocation } from '../../services/desktop-command-client.js';
import { z } from 'zod';
import { filterModelsByCategory, modelCategoryForCommand, type MediaModelCategory, type WorkspaceModelOption } from './model-catalog.js';

export type SlashCommandId = 'goal.run' | 'image.generate' | 'image.edit' | 'video.generate' | 'audio.speech' | 'audio.transcribe' | 'audio.translate';
export type SlashFieldType = 'text' | 'textarea' | 'select' | 'directory' | 'file' | 'multiple-file' | 'checkbox';

export interface SlashCommandField {
  name: string;
  label: string;
  type: SlashFieldType;
  placeholder?: string;
  options?: string[];
  accept?: readonly string[];
  required?: boolean;
  maxBytes?: number;
  maxTotalBytes?: number;
}

export interface SlashCommandDefinition {
  id: SlashCommandId;
  label: string;
  description: string;
  modelCategory?: MediaModelCategory;
  primaryLabel: string;
  primaryPlaceholder: string;
  primaryRequired?: boolean;
  fields: SlashCommandField[];
  advancedFields: SlashCommandField[];
}

export interface SlashCommandForm {
  primary: string;
  values: Record<string, string | boolean>;
  advancedOpen: boolean;
}

export interface SlashCommandErrors {
  primary?: string;
  fields: Record<string, string>;
}

export interface SlashCommandValidationOptions {
  showRequired?: boolean;
}

const OUTPUT_FIELDS: SlashCommandField[] = [
  { name: 'model', label: 'Model', type: 'select' },
  { name: 'out', label: 'Output filename', type: 'text', placeholder: 'Optional filename without extension' },
  { name: 'out-dir', label: 'Output directory', type: 'directory', placeholder: 'Optional local directory' },
  { name: 'force', label: 'Overwrite existing output', type: 'checkbox' },
];

const AUDIO_FILE_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm', 'mp4', 'mpeg', 'mpga', 'oga'];
const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

const IMAGE_FIELDS: SlashCommandField[] = [
  { name: 'n', label: 'Number of images', type: 'text', placeholder: '1' },
  { name: 'size', label: 'Size', type: 'select', options: ['auto', '1024x1024', '1536x1024', '1024x1536'] },
  { name: 'quality', label: 'Quality', type: 'select', options: ['auto', 'low', 'medium', 'high'] },
  { name: 'background', label: 'Background', type: 'select', options: ['auto', 'transparent', 'opaque'] },
  { name: 'output-format', label: 'Output format', type: 'select', options: ['png', 'jpeg', 'webp'] },
];

const IMAGE_ADVANCED_FIELDS: SlashCommandField[] = [
  { name: 'output-compression', label: 'Compression', type: 'text', placeholder: 'Optional 0-100' },
  { name: 'moderation', label: 'Moderation', type: 'text', placeholder: 'Optional policy' },
  { name: 'user', label: 'User identifier', type: 'text', placeholder: 'Optional identifier' },
  ...OUTPUT_FIELDS,
];

export const SLASH_COMMAND_DEFINITIONS: SlashCommandDefinition[] = [
  {
    id: 'goal.run', label: 'Goal', description: 'Run a focused autonomous goal.', primaryLabel: 'Objective', primaryPlaceholder: 'What should the agent accomplish?',
    fields: [
      { name: 'token-budget', label: 'Token budget', type: 'text', placeholder: 'Optional number' },
      { name: 'max-turns', label: 'Maximum turns', type: 'text', placeholder: 'Optional number' },
      { name: 'max-duration-ms', label: 'Maximum duration (ms)', type: 'text', placeholder: 'Optional number' },
    ], advancedFields: [],
  },
  {
    id: 'image.generate', label: 'Image', description: 'Generate an image from a prompt.', modelCategory: 'image', primaryLabel: 'Prompt', primaryPlaceholder: 'Describe the image to generate',
    fields: IMAGE_FIELDS, advancedFields: IMAGE_ADVANCED_FIELDS,
  },
  {
    id: 'image.edit', label: 'Image edit', description: 'Edit one or more workspace images.', modelCategory: 'image', primaryLabel: 'Prompt', primaryPlaceholder: 'Describe how to edit the image',
    fields: [
      { name: 'image', label: 'Source image(s)', type: 'multiple-file', accept: IMAGE_FILE_EXTENSIONS, required: true, maxBytes: 47 * 1_000_000, maxTotalBytes: 128 * 1_000_000 },
      { name: 'mask', label: 'Mask image', type: 'file', accept: IMAGE_FILE_EXTENSIONS, maxBytes: 4 * 1_000_000 },
      { name: 'input-fidelity', label: 'Input fidelity', type: 'select', options: ['low', 'high'] },
    ],
    advancedFields: [
      ...IMAGE_FIELDS,
      ...IMAGE_ADVANCED_FIELDS,
    ],
  },
  {
    id: 'video.generate', label: 'Video', description: 'Generate a video from a prompt.', modelCategory: 'video', primaryLabel: 'Prompt', primaryPlaceholder: 'Describe the video to generate',
    fields: [{ name: 'parameters', label: 'Parameters (JSON)', type: 'textarea', placeholder: '{ }' }, { name: 'no-wait', label: 'Return before completion', type: 'checkbox' }],
    advancedFields: OUTPUT_FIELDS,
  },
  {
    id: 'audio.speech', label: 'Audio', description: 'Convert text into speech.', modelCategory: 'speech', primaryLabel: 'Text', primaryPlaceholder: 'Text to synthesize',
    fields: [
      { name: 'voice', label: 'Voice', type: 'text', placeholder: 'Voice name', required: true },
      { name: 'instructions', label: 'Instructions', type: 'textarea', placeholder: 'Optional speaking instructions' },
      { name: 'response-format', label: 'Response format', type: 'select', options: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] },
      { name: 'speed', label: 'Speed', type: 'text', placeholder: '1.0' },
    ], advancedFields: OUTPUT_FIELDS,
  },
  {
    id: 'audio.transcribe', label: 'Audio transcribe', description: 'Transcribe an audio file.', modelCategory: 'transcription', primaryLabel: 'Prompt (optional)', primaryPlaceholder: 'Optional transcription prompt', primaryRequired: false,
    fields: [
      { name: 'file', label: 'Audio file', type: 'file', accept: AUDIO_FILE_EXTENSIONS, required: true, maxBytes: 50 * 1_000_000 },
      { name: 'language', label: 'Language code', type: 'text', placeholder: 'Optional language code' },
      { name: 'response-format', label: 'Response format', type: 'select', options: ['json', 'text', 'srt', 'verbose_json', 'vtt', 'diarized_json'] },
      { name: 'temperature', label: 'Temperature', type: 'text', placeholder: '0.0 - 1.0' },
      { name: 'timestamp-granularities', label: 'Timestamp granularities', type: 'text', placeholder: 'word,segment' },
      { name: 'include', label: 'Include fields', type: 'text', placeholder: 'Optional comma-separated fields' },
    ], advancedFields: [...OUTPUT_FIELDS],
  },
  {
    id: 'audio.translate', label: 'Audio translate', description: 'Translate an audio file.', modelCategory: 'translation', primaryLabel: 'Prompt (optional)', primaryPlaceholder: 'Optional translation prompt', primaryRequired: false,
    fields: [
      { name: 'file', label: 'Audio file', type: 'file', accept: AUDIO_FILE_EXTENSIONS, required: true, maxBytes: 50 * 1_000_000 },
      { name: 'response-format', label: 'Response format', type: 'select', options: ['json', 'text', 'srt', 'verbose_json', 'vtt'] },
      { name: 'temperature', label: 'Temperature', type: 'text', placeholder: '0.0 - 1.0' },
    ], advancedFields: [...OUTPUT_FIELDS],
  },
];

export function availableSlashCommands(descriptors: readonly DesktopCommandDescriptor[]): SlashCommandDefinition[] {
  const available = new Set(descriptors.map(descriptor => descriptor.id));
  return SLASH_COMMAND_DEFINITIONS.filter(command => available.has(command.id));
}

export function filterSlashCommands(commands: readonly SlashCommandDefinition[], query: string): SlashCommandDefinition[] {
  const normalized = query.trim().toLocaleLowerCase();
  return commands.filter(command => !normalized || command.label.toLocaleLowerCase().startsWith(normalized) || command.id.toLocaleLowerCase().startsWith(normalized));
}

export function createSlashCommandForm(command?: SlashCommandDefinition, models: readonly WorkspaceModelOption[] = []): SlashCommandForm {
  const values: Record<string, string | boolean> = {};
  for (const field of [...(command?.fields ?? []), ...(command?.advancedFields ?? [])]) {
    if (field.type === 'select' && field.options?.[0] !== undefined) values[field.name] = field.options[0];
  }
  const firstModel = command === undefined ? undefined : filterModelsByCategory(models, command.modelCategory)[0];
  if (firstModel !== undefined) values['model'] = firstModel.id;
  return { primary: '', values, advancedOpen: false };
}

export function modelsForSlashCommand(command: SlashCommandDefinition, models: readonly WorkspaceModelOption[]): WorkspaceModelOption[] {
  return filterModelsByCategory(models, command.modelCategory ?? modelCategoryForCommand(command.id));
}

export function createSlashInvocation(command: SlashCommandDefinition, form: SlashCommandForm): DesktopCommandInvocation {
  const errors = validateSlashCommandForm(command, form);
  const firstError = errors.primary ?? Object.values(errors.fields)[0];
  if (firstError !== undefined) throw new Error(firstError);
  const primary = form.primary.trim();
  const values = Object.fromEntries(Object.entries(form.values).filter(([, value]) => value !== '' && value !== false));
  const positionals = command.id === 'audio.transcribe' || command.id === 'audio.translate' ? [] : primary ? [primary] : [];
  return { actionId: command.id, positionals, options: { ...((command.id === 'audio.transcribe' || command.id === 'audio.translate') && primary ? { prompt: primary } : {}), ...values } };
}

/**
 * Mirrors the CLI's public input contract for immediate form feedback. The CLI
 * remains authoritative and validates again at execution time.
 */
export function validateSlashCommandForm(command: SlashCommandDefinition, form: SlashCommandForm, options: SlashCommandValidationOptions = {}): SlashCommandErrors {
  const errors: SlashCommandErrors = { fields: {} };
  const showRequired = options.showRequired !== false;
  const primary = form.primary.trim();
  const primaryLimit = command.id === 'image.generate' || command.id === 'image.edit' ? { maxCharacters: 32_000, label: 'Prompt' }
    : command.id === 'audio.speech' ? { maxCharacters: 4_096, label: 'Text' }
      : command.id === 'audio.transcribe' || command.id === 'audio.translate' ? { maxCharacters: 4_096, label: 'Prompt' }
        : { maxCharacters: 16_384, label: command.primaryLabel };
  if (command.primaryRequired !== false && primary.length === 0 && showRequired) errors.primary = `${command.primaryLabel} is required.`;
  if (primary.length > 0 && primary.length > primaryLimit.maxCharacters) errors.primary = `${primaryLimit.label} must not exceed ${primaryLimit.maxCharacters.toLocaleString()} characters.`;

  const value = (name: string): string => typeof form.values[name] === 'string' ? String(form.values[name]).trim() : '';
  const hasValue = (name: string): boolean => value(name).length > 0 || form.values[name] === true;
  for (const field of [...command.fields, ...command.advancedFields]) {
    if (field.required && !hasValue(field.name) && showRequired) errors.fields[field.name] = `${field.label} is required.`;
  }
  if (command.id === 'goal.run') {
    validatePositiveInteger(value('token-budget'), 'Token budget', 10_000_000, errors.fields);
    validatePositiveInteger(value('max-turns'), 'Maximum turns', 10_000, errors.fields);
    validatePositiveInteger(value('max-duration-ms'), 'Maximum duration', 8 * 60 * 60 * 1_000, errors.fields);
  }
  if (command.id === 'image.generate' || command.id === 'image.edit') {
    validateInteger(value('n'), 'Number of images', 1, 16, errors.fields);
    validateImageSize(value('size'), errors.fields);
    if (value('n') && Number(value('n')) > 1 && value('out')) errors.fields['out'] = 'Output filename can only be used for one image.';
    validateInteger(value('output-compression'), 'Compression', 0, 100, errors.fields);
    if (value('output-compression') && !['jpeg', 'webp'].includes(value('output-format'))) errors.fields['output-compression'] = 'Compression requires JPEG or WebP output format.';
    validateMaxLength(value('moderation'), 'Moderation', 64, errors.fields);
    validateMaxLength(value('user'), 'User identifier', 255, errors.fields);
    if (command.id === 'image.edit' && value('image').split(',').map(item => item.trim()).filter(Boolean).length > 16) errors.fields['image'] = 'Image edits support at most 16 input images.';
  }
  if (command.id === 'audio.speech') {
    validateMaxLength(value('voice'), 'Voice', 64, errors.fields);
    validateMaxLength(value('instructions'), 'Speech instructions', 4_096, errors.fields);
    validateNumber(value('speed'), 'Speed', 0.25, 4, errors.fields);
  }
  if (command.id === 'audio.transcribe' || command.id === 'audio.translate') {
    validateNumber(value('temperature'), 'Temperature', 0, 1, errors.fields);
    if (command.id === 'audio.transcribe') {
      validateMaxLength(value('language'), 'Language code', 10, errors.fields);
      if (value('timestamp-granularities') && value('response-format') !== 'verbose_json') errors.fields['timestamp-granularities'] = 'Timestamp granularities require verbose_json response format.';
      if (value('timestamp-granularities') && value('timestamp-granularities').split(',').map(item => item.trim()).some(item => !['word', 'segment'].includes(item))) errors.fields['timestamp-granularities'] = 'Timestamp granularities may only contain word or segment.';
    }
  }
  if (command.id === 'video.generate' && value('parameters')) {
    const jsonObject = z.string().refine(raw => {
      try { const parsed: unknown = JSON.parse(raw); return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed); }
      catch { return false; }
    });
    if (!jsonObject.safeParse(value('parameters')).success) errors.fields['parameters'] = 'Parameters must be a valid JSON object.';
  }
  if (form.values['force'] === true && !value('out')) errors.fields['force'] = 'Overwrite requires an output filename.';
  if (form.values['no-wait'] === true && (value('out') || value('out-dir') || form.values['force'] === true)) errors.fields['no-wait'] = 'Return before completion cannot be combined with output options.';
  if (value('out') && !isValidOutputName(value('out'))) errors.fields['out'] = 'Output filename must not contain path separators or control characters.';
  return errors;
}

function validatePositiveInteger(raw: string, label: string, maximum: number, errors: Record<string, string>): void {
  if (!raw) return;
  const schema = z.string().regex(/^\d+$/u).refine(value => Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= maximum);
  if (!schema.safeParse(raw).success) errors[camelCaseField(label)] = `${label} must be a positive integer no greater than ${maximum.toLocaleString()}.`;
}

function validateInteger(raw: string, label: string, minimum: number, maximum: number, errors: Record<string, string>): void {
  if (!raw) return;
  const schema = z.string().regex(/^\d+$/u).refine(value => Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= maximum);
  if (!schema.safeParse(raw).success) errors[FIELD_NAMES[label] ?? label] = `${label} must be an integer between ${minimum} and ${maximum}.`;
}

function validateNumber(raw: string, label: string, minimum: number, maximum: number, errors: Record<string, string>): void {
  if (!raw) return;
  const schema = z.string().refine(value => { const number = Number(value); return Number.isFinite(number) && number >= minimum && number <= maximum; });
  if (!schema.safeParse(raw).success) errors[FIELD_NAMES[label] ?? label] = `${label} must be between ${minimum} and ${maximum}.`;
}

function validateMaxLength(raw: string, label: string, maximum: number, errors: Record<string, string>): void {
  if (!z.string().max(maximum).safeParse(raw).success) errors[FIELD_NAMES[label] ?? label] = `${label} must not exceed ${maximum.toLocaleString()} characters.`;
}

function validateImageSize(raw: string, errors: Record<string, string>): void {
  if (!raw || raw === 'auto') return;
  const schema = z.string().regex(/^(\d{2,4})x(\d{2,4})$/u).refine(value => {
    const dimensions = value.split('x').map(Number);
    const width = dimensions[0] ?? 0;
    const height = dimensions[1] ?? 0;
    return width >= 1 && height >= 1 && width <= 4_096 && height <= 4_096 && Math.max(width, height) / Math.min(width, height) <= 3 && width % 16 === 0 && height % 16 === 0;
  });
  if (!schema.safeParse(raw).success) errors['size'] = 'Size must use dimensions up to 4096px, a maximum 3:1 ratio, and multiples of 16.';
}

const FIELD_NAMES: Record<string, string> = { 'Number of images': 'n', Compression: 'output-compression', Speed: 'speed', Temperature: 'temperature', 'Language code': 'language', 'Voice': 'voice', 'Speech instructions': 'instructions', 'Moderation': 'moderation', 'User identifier': 'user' };
function camelCaseField(label: string): string { return label === 'Token budget' ? 'token-budget' : label === 'Maximum turns' ? 'max-turns' : 'max-duration-ms'; }
function isValidOutputName(value: string): boolean { return z.string().min(1).refine(candidate => candidate !== '.' && candidate !== '..' && !candidate.includes('/') && !candidate.includes('\\') && ![...candidate].some(character => (character.codePointAt(0) ?? 0) < 32 || (character.codePointAt(0) ?? 0) === 127)).safeParse(value).success; }

export function slashCommandPreview(command: SlashCommandDefinition, form: SlashCommandForm): string {
  return `${slashCommandLabel(command)} ${form.primary.trim()}`.trim();
}

export function slashCommandLabel(command: SlashCommandDefinition): string {
  const [namespace, action] = command.id.split('.');
  return `/${namespace} ${action}`;
}
