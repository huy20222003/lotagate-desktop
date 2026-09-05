const APPROVAL_DENIAL_PATTERN = /tool action was denied|approval(?: was)? denied|active workspace policy/iu;

export function formatTurnFailure(reason: string | undefined): string {
  const message = reason?.trim();
  if (message !== undefined && APPROVAL_DENIAL_PATTERN.test(message)) return 'The requested action was not completed because approval was declined.';
  return message === undefined || message.length === 0 ? 'The response could not be completed.' : `The response could not be completed: ${message}`;
}
