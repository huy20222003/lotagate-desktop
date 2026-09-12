export const PROMPT_TOKEN_PATTERN = /(@[^\s]+|https?:\/\/[^\s]+|(?<!\S)\/[A-Za-z0-9][^\s/\\]*(?=$|\s))/gu;
export const PROMPT_TOKEN_EXACT_PATTERN = /^(?:@[^\s]+|https?:\/\/[^\s]+|\/[A-Za-z0-9][^\s/\\]*)$/u;
export const PROMPT_REFERENCE_TOKEN_PATTERN = /(?:@[^\s]+|(?<!\S)\/[A-Za-z0-9][^\s/\\]*(?=$|\s))/gu;
export const SLASH_COMMAND_TOKEN_PATTERN = /(?<!\S)\/[A-Za-z0-9][^\s/\\]*(?=$|\s)/gu;
