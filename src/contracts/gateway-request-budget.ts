/** Public Gateway JSON body limit mirrored from the server/SDK contract. */
export const GATEWAY_JSON_BODY_LIMIT_BYTES = 20 * 1_000_000;
export const GATEWAY_JSON_NEAR_LIMIT_RATIO = 0.8;

export interface GatewayAttachmentBudgetInput {
  readonly byteLength: number;
  readonly mimeType: string;
  readonly name?: string;
}

export interface GatewayRequestBudget {
  readonly projectedBytes: number;
  readonly limitBytes: number;
  readonly remainingBytes: number;
  readonly utilization: number;
  readonly isWithinLimit: boolean;
  readonly isNearLimit: boolean;
}

export function evaluateGatewayRequestBudget(prompt: string, attachments: readonly GatewayAttachmentBudgetInput[] = [], reservedBytes = 0): GatewayRequestBudget {
  const projectedBytes = estimateGatewayMessageBytes(prompt, attachments) + Math.max(0, reservedBytes);
  const remainingBytes = GATEWAY_JSON_BODY_LIMIT_BYTES - projectedBytes;
  return { projectedBytes, limitBytes: GATEWAY_JSON_BODY_LIMIT_BYTES, remainingBytes, utilization: projectedBytes / GATEWAY_JSON_BODY_LIMIT_BYTES, isWithinLimit: projectedBytes <= GATEWAY_JSON_BODY_LIMIT_BYTES, isNearLimit: projectedBytes >= GATEWAY_JSON_BODY_LIMIT_BYTES * GATEWAY_JSON_NEAR_LIMIT_RATIO };
}

export function estimateGatewayMessageBytes(prompt: string, attachments: readonly GatewayAttachmentBudgetInput[] = []): number {
  const message = attachments.length === 0
    ? { role: 'user', content: prompt }
    : { role: 'user', content: [{ type: 'text', text: prompt }, ...attachments.map(attachmentPart)] };
  const skeletonBytes = new TextEncoder().encode(JSON.stringify({ messages: [message] })).byteLength;
  return skeletonBytes + attachments.reduce((total, attachment) => total + base64ByteLength(attachment.byteLength), 0);
}

export function base64ByteLength(byteLength: number): number {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new RangeError('Attachment byte length must be a non-negative safe integer.');
  return Math.ceil(byteLength / 3) * 4;
}

export function mimeTypeForAttachmentKind(kind: string): string {
  if (kind === 'image') return 'image/png';
  if (kind === 'audio') return 'audio/mpeg';
  if (kind === 'video') return 'video/mp4';
  if (kind === 'markdown' || kind === 'text' || kind === 'patch' || kind === 'json') return 'text/plain';
  return 'application/octet-stream';
}

function attachmentPart(attachment: GatewayAttachmentBudgetInput): Record<string, unknown> {
  const dataUrl = `data:${attachment.mimeType};base64:`;
  if (attachment.mimeType.startsWith('image/')) return { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } };
  return { type: 'input_file', file_data: dataUrl, filename: attachment.name ?? 'attachment', media_type: attachment.mimeType };
}
