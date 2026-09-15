import { describe, expect, it } from 'vitest';
import { evaluateGatewayRequestBudget } from './gateway-request-budget.js';

describe('gateway request budget', () => {
  it('rejects a raw attachment whose Base64 form exceeds the 20 MB JSON body', () => {
    const result = evaluateGatewayRequestBudget('describe this', [{ byteLength: 15_000_000, mimeType: 'image/png', name: 'large.png' }]);
    expect(result.isWithinLimit).toBe(false);
    expect(result.limitBytes).toBe(20_000_000);
  });

  it('marks a request near the limit without rejecting it', () => {
    const result = evaluateGatewayRequestBudget('describe this', [{ byteLength: 12_500_000, mimeType: 'image/png', name: 'near-limit.png' }]);
    expect(result.isWithinLimit).toBe(true);
    expect(result.isNearLimit).toBe(true);
  });
});
