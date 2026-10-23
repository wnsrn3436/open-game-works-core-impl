import { createHmac } from 'node:crypto';
import type { TurnAdapter, TurnRelayCredential } from '../turn.ts';

/** The schemes a coturn relay URL may have. */
const SCHEMES: readonly string[] = ['turn:', 'turns:'];

/** The TURN REST API username of a match: `<expires_at ÷ 1000>:<match_id>`. */
export function coturn_username(match_id: string, expires_at: bigint): string {
  return `${String(expires_at / 1000n)}:${match_id}`;
}

/** The TURN REST API credential of a username: HMAC-SHA1 with the coturn `static-auth-secret` as key, in standard base64. */
export function coturn_credential(secret: string, username: string): string {
  return createHmac('sha1', secret).update(username).digest('base64');
}

/** The first URL whose scheme is neither `turn` nor `turns`, or null. */
export function bad_coturn_url(urls: readonly string[]): string | null {
  return urls.find((url) => !SCHEMES.some((scheme) => url.startsWith(scheme))) ?? null;
}

/**
 * The real adapter `turn-coturn`: short-lived TURN REST API credentials of the coturn servers the operator runs,
 * made without a network call. One relay per URL.
 */
export function create_turn_coturn_adapter(urls: readonly string[], secret: string): TurnAdapter {
  return {
    issue_relays(match_id, expires_at) {
      const username = coturn_username(match_id, expires_at);
      const credential = coturn_credential(secret, username);
      const relays: TurnRelayCredential[] = urls.map((url) => ({ url, username, credential }));
      return Promise.resolve(relays);
    },
  };
}
