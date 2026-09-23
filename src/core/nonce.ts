import { createHash } from 'node:crypto';

/**
 * A stable nonce for one delivery. Sent with `enforce_nonce`, Discord returns the existing
 * message instead of posting twice if the same delivery is retried after a crash.
 */
export function deliveryNonce(feedId: string, releaseKey: string): string {
  return createHash('sha256').update(`${feedId}\0${releaseKey}`).digest('base64url').slice(0, 25);
}
