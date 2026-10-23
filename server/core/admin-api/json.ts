/**
 * JSON of admin requests and responses: a body parse that keeps each number's source text, and the output form
 * (`int64` as decimal strings, bytes as standard base64). The canonical form of `input_sha256` is `storage`'s.
 */
import { createHash } from 'node:crypto';

/** A JSON number of a parsed body, kept as its source text so that `1.0`, `1e3` and integers past 2^53 stay apart. */
export class JsonNumber {
  readonly source: string;

  constructor(source: string) {
    this.source = source;
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const ENCODER = new TextEncoder();

type Reviver = (key: string, value: unknown, context: { source: string }) => unknown;

/** Parses a UTF-8 JSON body with numbers as `JsonNumber`. Null when the bytes are not UTF-8 JSON. */
export function parse_json(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return null;
  }
  const reviver: Reviver = (_key, value, context) => (typeof value === 'number' ? new JsonNumber(context.source) : value);
  try {
    return JSON.parse(text, reviver as (key: string, value: unknown) => unknown);
  } catch {
    return null;
  }
}

/** A JSON object that is not an array and not a `JsonNumber`. */
export function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof JsonNumber);
}

const INTEGER = /^-?(0|[1-9][0-9]*)$/;

/** True when the text is a decimal integer without fraction, exponent or leading zeros. */
export function is_integer_text(text: string): boolean {
  return INTEGER.test(text);
}

/** A parsed value with `JsonNumber` replaced: safe integers and non-integers by `number`, other integers by `bigint`. */
export function plain_json(value: unknown): unknown {
  if (value instanceof JsonNumber) {
    if (!is_integer_text(value.source)) return Number(value.source);
    const big = BigInt(value.source);
    return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
  }
  if (Array.isArray(value)) return value.map(plain_json);
  if (is_plain_object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain_json(v)]));
  return value;
}

export function sha256_hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A value made JSON-safe for a response or log: `bigint` as a decimal string, bytes as standard base64. */
export function output_json(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(output_json);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, output_json(v)]));
  }
  return value;
}

export function utf8_bytes(text: string): Uint8Array {
  return ENCODER.encode(text);
}

export function utf8_length(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
