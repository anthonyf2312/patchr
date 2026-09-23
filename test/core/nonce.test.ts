import { describe, expect, it } from 'vitest';
import { deliveryNonce } from '../../src/core/nonce.js';

describe('deliveryNonce', () => {
  it('is the same for the same delivery', () => {
    expect(deliveryNonce('feed-1', 'github:123')).toBe(deliveryNonce('feed-1', 'github:123'));
  });

  it('differs between deliveries', () => {
    expect(deliveryNonce('feed-1', 'github:123')).not.toBe(deliveryNonce('feed-2', 'github:123'));
    expect(deliveryNonce('feed-1', 'github:123')).not.toBe(deliveryNonce('feed-1', 'github:124'));
  });

  it("fits Discord's 25-character nonce limit", () => {
    expect(deliveryNonce('x'.repeat(200), 'y'.repeat(200)).length).toBeLessThanOrEqual(25);
  });
});
