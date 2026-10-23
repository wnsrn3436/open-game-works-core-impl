import { createHmac } from 'node:crypto';

/**
 * The account token of a user (`### pre-purchase check`): the first 16 bytes of HMAC-SHA256 of the user ID decimal
 * string, keyed by the UTF-8 bytes of the `iapAccountToken` secret, in lowercase UUID form `8-4-4-4-12`.
 */
export function account_token_of(key: string, user_id: bigint): string {
  const hex = createHmac('sha256', Buffer.from(key, 'utf8')).update(user_id.toString(10), 'utf8').digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
