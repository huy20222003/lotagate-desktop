import type { DesktopCommandDescriptor, DesktopCommandInvocation } from '../../../services/desktop-command-client.js';
import { z } from 'zod';
import { filterModelsByCategory, modelCategoryForCommand, type MediaModelCategory, type WorkspaceModelOption } from '../../../services/model-catalog.js';
import { REMOTE_SLASH_COMMAND_DEFINITIONS, type RemoteSlashCommandDefinition, type RemoteSlashCommandField } from '../../../../contracts/remote-control/v1/slash-command-catalog.js';

export type SlashCommandField = RemoteSlashCommandField;
export type SlashCommandDefinition = Omit<RemoteSlashCommandDefinition, 'modelCategory' | 'fields' | 'advancedFields'> & { modelCategory?: MediaModelCategory; fields: SlashCommandField[]; advancedFields: SlashCommandField[] };
export { REMOTE_SLASH_COMMAND_DEFINITIONS as SLASH_COMMAND_DEFINITIONS };

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

export function availableSlashCommands(descriptors: readonly DesktopCommandDescriptor[]): SlashCommandDefinition[] {
  const available = new Set(descriptors.map(descriptor => descriptor.id));
  return REMOTE_SLASH_COMMAND_DEFINITIONS.filter(command => available.has(command.id)) as SlashCommandDefinition[];
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
  if (command.id === 'goal.run') {
    validatePositiveInteger(value('token-budget'), 'Token budget', 10_000_000, errors.fields);
    validatePositiveInteger(value('max-turns'), 'Maximum turns', 10_000, errors.fields);
    validatePositiveInteger(value('max-duration-ms'), 'Maximum duration', 8 * 60 * 60 * 1_000, errors.fields);
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

function validateInteger(raw: string, label: string, minimum: number, maximum: number, errors: Record<string, string>): void {
  if (!raw) return;
  const schema = z.string().regex(/^\d+$/u).refine(value => Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= maximum);
  if (!schema.safeParse(raw).success) errors[FIELD_NAMES[label] ?? label] = `${label} must be an integer between ${minimum} and ${maximum}.`;
}

function validatePositiveInteger(raw: string, label: string, maximum: number, errors: Record<string, string>): void {
  if (!raw) return;
  const schema = z.string().regex(/^\d+$/u).refine(value => Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= maximum);
  const field = label === 'Token budget' ? 'token-budget' : label === 'Maximum turns' ? 'max-turns' : 'max-duration-ms';
  if (!schema.safeParse(raw).success) errors[field] = `${label} must be a positive integer no greater than ${maximum.toLocaleString()}.`;
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

const FIELD_NAMES: Record<string, string> = { 'Number of images': 'n', Compression: 'output-compression', Speed: 'speed', Temperature: 'temperature', 'Language code': 'language', 'Voice': 'voice', 'Speech instructions': 'instructions', Moderation: 'moderation', 'User identifier': 'user' };
function isValidOutputName(value: string): boolean { return z.string().min(1).refine(candidate => candidate !== '.' && candidate !== '..' && !candidate.includes('/') && !candidate.includes('\\') && ![...candidate].some(character => (character.codePointAt(0) ?? 0) < 32 || (character.codePointAt(0) ?? 0) === 127)).safeParse(value).success; }

export function slashCommandPreview(command: SlashCommandDefinition, form: SlashCommandForm): string {
  return `${slashCommandLabel(command)} ${form.primary.trim()}`.trim();
}

export function slashCommandLabel(command: SlashCommandDefinition): string {
  const [namespace, action] = command.id.split('.');
  return `/${namespace} ${action}`;
}
