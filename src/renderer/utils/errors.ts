export function toUserErrorMessage(reason: unknown, fallback = 'The operation failed.'): string {
  return reason instanceof Error && reason.message.trim() ? reason.message : fallback;
}
