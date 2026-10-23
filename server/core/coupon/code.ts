/**
 * Coupon code rules (`coupon` `## behavior` code): normalization, the format check, the `coupon.codeAlphabet` server
 * start rule and `unique` code generation.
 */
import { randomInt } from 'node:crypto';

/** The code rules of the core settings `coupon.codeAlphabet`, `coupon.minCodeLength`, `coupon.maxCodeLength`. */
export interface CodeRules {
  readonly alphabet: string;
  readonly min_length: number;
  readonly max_length: number;
}

// `-` and the Unicode `White_Space` characters.
const REMOVED = /[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000-]/gu;
const ASCII_LOWER = /[a-z]/g;
const ALPHABET_CHAR = /^[A-Z0-9]$/;

/** Removes `-` and white space anywhere in the input and turns ASCII lowercase letters into uppercase. */
export function normalize_code(input: string): string {
  return input.replace(REMOVED, '').replace(ASCII_LOWER, (letter) => String.fromCharCode(letter.charCodeAt(0) - 32));
}

/** True when a normalized code uses only alphabet characters and its length is within the limits. */
export function is_valid_code(code: string, rules: CodeRules): boolean {
  if (code.length < rules.min_length || code.length > rules.max_length) return false;
  for (const char of code) {
    if (!rules.alphabet.includes(char)) return false;
  }
  return true;
}

/** The server start rule of `coupon.codeAlphabet`: null, or why it fails. */
export function alphabet_error(alphabet: string): string | null {
  if (alphabet === '') return 'coupon: coupon.codeAlphabet is empty';
  const seen = new Set<string>();
  for (const char of alphabet) {
    if (!ALPHABET_CHAR.test(char)) return `coupon: coupon.codeAlphabet has ${JSON.stringify(char)}, not an ASCII uppercase letter or digit`;
    if (seen.has(char)) return `coupon: coupon.codeAlphabet has ${char} twice`;
    seen.add(char);
  }
  return null;
}

/** A code of `length` characters picked from the alphabet with secure random. */
export function generate_code(alphabet: string, length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += alphabet.charAt(randomInt(alphabet.length));
  return code;
}

// Every character a code can hold, in byte order.
const CODE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The smallest string of code characters `bound` such that a code is byte after `after` exactly when it is at least
 * `bound`, or null when no code is byte after `after`. `after` is any string. The bound holds only code characters, so
 * an `after` the DB cannot take as text (a NUL character, which PostgreSQL text refuses) never reaches the query.
 */
export function code_bound_after(after: string): string | null {
  let prefix = 0;
  while (prefix < after.length && CODE_CHARS.includes(after.charAt(prefix))) prefix += 1;
  // A code byte after `after` either goes on from `after.slice(0, prefix)` with a character after the next character
  // of `after` (any character when `after` ends there), or leaves that prefix with a greater character.
  const next = prefix === after.length ? '0' : Array.from(CODE_CHARS).find((char) => char > after.charAt(prefix));
  if (next !== undefined) return after.slice(0, prefix) + next;
  // Nothing follows the prefix, so the bound is the smallest code character string after every string that starts with it.
  const head = after.slice(0, prefix).replace(/Z+$/, '');
  if (head === '') return null;
  return head.slice(0, -1) + CODE_CHARS.charAt(CODE_CHARS.indexOf(head.charAt(head.length - 1)) + 1);
}
