/**
 * Remote config values: the data `default_value` text, the admin JSON value, and the stored text of the
 * `remote_config_override.value` column and the experiment group values.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';

export type ValueType = 'Bool' | 'Int' | 'String';

export type Value =
  | { readonly type: 'Bool'; readonly v: boolean }
  | { readonly type: 'Int'; readonly v: bigint }
  | { readonly type: 'String'; readonly v: string };

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const DECIMAL = /^-?(0|[1-9][0-9]*)$/;

const utf8 = new TextEncoder();

/** The value type of a data `RemoteConfigType` element, or null for `None` and unknown values. */
export function type_of(type: GameData.RemoteConfigType): ValueType | null {
  switch (type) {
    case GameData.RemoteConfigType.Bool:
      return 'Bool';
    case GameData.RemoteConfigType.Int:
      return 'Int';
    case GameData.RemoteConfigType.String:
      return 'String';
    default:
      return null;
  }
}

function int64(text: string): bigint | null {
  if (!DECIMAL.test(text)) return null;
  const v = BigInt(text);
  return v < INT64_MIN || v > INT64_MAX ? null : v;
}

/** The data `default_value` read as `type`, or null when it does not read as that type. */
export function parse_default(type: ValueType, text: string): Value | null {
  switch (type) {
    case 'Bool':
      return text === 'true' || text === 'false' ? { type, v: text === 'true' } : null;
    case 'Int': {
      // A `long` integer cell: digits with an optional minus sign, leading zeros allowed.
      if (!/^-?[0-9]+$/.test(text)) return null;
      const v = BigInt(text);
      return v < INT64_MIN || v > INT64_MAX ? null : { type, v };
    }
    case 'String':
      return { type, v: text };
  }
}

/**
 * An admin JSON value read as `type` (`set_config_value` `value` and `put_experiment` `values`): a bool, an int64
 * integer (a JSON number that is a safe integer, a `bigint` `admin-api` gives for an integer outside that range, or an
 * int64 decimal string), or a string of at most `max_string_bytes` UTF-8 bytes. Null when it breaks the rule.
 */
export function parse_admin_value(type: ValueType, json: unknown, max_string_bytes: number): Value | null {
  switch (type) {
    case 'Bool':
      return typeof json === 'boolean' ? { type, v: json } : null;
    case 'Int': {
      if (typeof json === 'number') return Number.isSafeInteger(json) ? { type, v: BigInt(json) } : null;
      if (typeof json === 'bigint') return json < INT64_MIN || json > INT64_MAX ? null : { type, v: json };
      const v = typeof json === 'string' ? int64(json) : null;
      return v === null ? null : { type, v };
    }
    case 'String':
      return typeof json === 'string' && utf8.encode(json).length <= max_string_bytes ? { type, v: json } : null;
  }
}

/** The stored text of a value: `true` or `false`, a decimal integer, or a JSON string. */
export function encode_stored(value: Value): string {
  switch (value.type) {
    case 'Bool':
      return value.v ? 'true' : 'false';
    case 'Int':
      return value.v.toString(10);
    case 'String':
      return JSON.stringify(value.v);
  }
}

/** A stored text read back with the type it was written with, or null when it is not a stored text. */
export function decode_stored(text: string): Value | null {
  if (text === 'true' || text === 'false') return { type: 'Bool', v: text === 'true' };
  const v = int64(text);
  if (v !== null) return { type: 'Int', v };
  if (!text.startsWith('"')) return null;
  try {
    const s: unknown = JSON.parse(text);
    return typeof s === 'string' ? { type: 'String', v: s } : null;
  } catch {
    return null;
  }
}

/** The JSON value of a value for an admin output. An `Int` is a bigint, which `admin-api` writes as a decimal string. */
export function to_json(value: Value): boolean | bigint | string {
  return value.v;
}

/** The base proto `RemoteConfigValue` of a value: `kind` and only the field of that kind. */
export function to_proto(value: Value): CoreContract.RemoteConfigValue {
  const out = new CoreContract.RemoteConfigValue();
  switch (value.type) {
    case 'Bool':
      out.kind = CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_BOOL;
      out.bool_value = value.v;
      break;
    case 'Int':
      out.kind = CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_INT;
      out.int_value = value.v;
      break;
    case 'String':
      out.kind = CoreContract.RemoteConfigValueKind.REMOTE_CONFIG_VALUE_KIND_STRING;
      out.string_value = value.v;
      break;
  }
  return out;
}
