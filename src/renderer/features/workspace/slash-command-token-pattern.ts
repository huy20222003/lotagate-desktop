import { REMOTE_SLASH_COMMAND_DEFINITIONS } from '../../../contracts/remote-control/v1/slash-command-catalog.js';

export function slashCommandLabelForId(commandId: string): string {
  return `/${commandId.split('.').join(' ')}`;
}

const SLASH_COMMAND_LABELS = [...new Set(REMOTE_SLASH_COMMAND_DEFINITIONS.map(command => slashCommandLabelForId(command.id)))].sort((left, right) => right.length - left.length);
const SLASH_COMMAND_ALTERNATION = SLASH_COMMAND_LABELS.map(escapeRegExp).join('|');
const SLASH_COMMAND_TOKEN_SOURCE = `(?<!\\S)(?:${SLASH_COMMAND_ALTERNATION}|/[A-Za-z0-9][^\\s/:\\\\]*)(?=$|\\s)`;

export const SLASH_COMMAND_TOKEN_PATTERN = new RegExp(SLASH_COMMAND_TOKEN_SOURCE, 'gu');
export const PROMPT_TOKEN_PATTERN = new RegExp(`(@[^\\s]+|https?:\\/\\/[^\\s]+|${SLASH_COMMAND_TOKEN_SOURCE})`, 'gu');
export const PROMPT_TOKEN_EXACT_PATTERN = new RegExp(`^(?:@[^\\s]+|https?:\\/\\/[^\\s]+|${SLASH_COMMAND_TOKEN_SOURCE})$`, 'u');
export const PROMPT_REFERENCE_TOKEN_PATTERN = new RegExp(`(?:@[^\\s]+|${SLASH_COMMAND_TOKEN_SOURCE})`, 'gu');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
