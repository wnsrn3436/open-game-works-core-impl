/**
 * Canonical JSON: object keys in UTF-8 byte order, no whitespace. Modules hash or sign this text, so one function makes
 * it for all of them. `bigint` is written as a JSON integer, bytes as a standard base64 string, and an object field
 * whose value is `undefined` is left out.
 */

function byte_order(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function class_name(value: object): string {
  const name: unknown = (value as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === 'string' ? name : 'no class';
}

/** True for an object written as a JSON object: one whose prototype is `Object.prototype` or null. */
function is_plain_object(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The canonical JSON text of a value. A number that is not finite, or a value JSON has no form for (`undefined`, a
 * function, a symbol, and an object that is not an array, bytes or a plain object, such as a `Map` or a `Date`), throws.
 */
export function canonical_json(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical_json: a number that is not finite');
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return JSON.stringify(value);
  if (value instanceof Uint8Array) return JSON.stringify(Buffer.from(value).toString('base64'));
  if (Array.isArray(value)) return `[${Array.from(value, (v) => canonical_json(v)).join(',')}]`;
  if (typeof value === 'object' && is_plain_object(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => byte_order(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical_json(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonical_json: ${typeof value === 'object' ? `an object of ${class_name(value)}` : typeof value} is not JSON`);
}
