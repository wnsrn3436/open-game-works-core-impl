/**
 * User IDs and public codes (`storage` `### base table`): a user ID is a secure random integer of 1 or more and below
 * 2^53, and a public code is 8 secure random characters of `PUBLIC_CODE_CHARS`.
 */
import { randomBytes } from 'node:crypto';

export const PUBLIC_CODE_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PUBLIC_CODE_LENGTH = 8;

const USER_ID_MASK = (1n << 53n) - 1n;
const PUBLIC_CODE = new RegExp(`^[${PUBLIC_CODE_CHARS}]{${String(PUBLIC_CODE_LENGTH)}}$`);
const IGNORED = /[\t\n\r -]/g;
const LOWER = /[a-z]/g;

/** A user ID: secure random, 1 or more and below 2^53. */
export function pick_user_id(): bigint {
  for (;;) {
    const id = randomBytes(8).readBigUInt64BE() & USER_ID_MASK;
    if (id !== 0n) return id;
  }
}

/** A public code: 8 characters of the 32 public code characters; one byte's low 5 bits are uniform over 32. */
export function pick_public_code(): string {
  return [...randomBytes(PUBLIC_CODE_LENGTH)].map((b) => PUBLIC_CODE_CHARS[b & 31]).join('');
}

/** The public code a text is the public code input of, or null when it is not one (`### base table` public code input). */
export function normalize_public_code(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const code = text
    .replace(IGNORED, '')
    .replace(LOWER, (c) => c.toUpperCase())
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return PUBLIC_CODE.test(code) ? code : null;
}
