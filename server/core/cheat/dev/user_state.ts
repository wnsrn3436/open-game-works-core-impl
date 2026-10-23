// `SetUserState` and `DeleteUserState`: content UserState kinds only, by kind name.
import type * as CoreContract from '../../../generated/contract/core_contract.ts';

type KindInfo = CoreContract.KindInfo;
type JsonKindClass = { from_json(json: unknown): object | null };

/**
 * The content UserState kind named `name` that takes `item_id`, or null. `game_kinds` and `core_kinds` are the
 * `KINDS` of the game contract and the base proto. A core kind, a server state or game state kind, an unknown name and
 * a single kind with an item ID other than 0 are null.
 */
export function find_content_kind(
  game_kinds: readonly KindInfo[],
  core_kinds: readonly KindInfo[],
  name: string,
  item_id: bigint,
): KindInfo | null {
  if (core_kinds.some((kind) => kind.name === name)) return null;
  const kind = game_kinds.find((k) => k.store === 'user_state' && k.name === name);
  if (kind === undefined) return null;
  if (!kind.is_list && item_id !== 0n) return null;
  return kind;
}

/**
 * The kind message of `value_json` (proto3 JSON), or null when it is not JSON, not that kind, has a key that is not a
 * field, has a string with a lone surrogate (the stored bytes would not be that string), or is a list item whose `id`
 * is not `item_id`.
 */
export function decode_user_state(kind: KindInfo, item_id: bigint, value_json: string): object | null {
  let json: unknown;
  try {
    json = JSON.parse(value_json);
  } catch {
    return null;
  }
  if (!well_formed(json)) return null;
  const value = (kind.kind_class as unknown as JsonKindClass).from_json(json);
  if (value === null || !only_fields(json, value)) return null;
  if (kind.is_list && (value as { id?: unknown }).id !== item_id) return null;
  return value;
}

/** Every string of `json`, keys included, down through objects and arrays, is well-formed UTF-16. */
function well_formed(json: unknown): boolean {
  if (typeof json === 'string') return json.isWellFormed();
  if (Array.isArray(json)) return json.every(well_formed);
  if (typeof json === 'object' && json !== null) {
    return Object.entries(json).every(([key, value]) => key.isWellFormed() && well_formed(value));
  }
  return true;
}

function json_key(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_match: string, ch: string) => ch.toUpperCase());
}

function is_message(value: unknown): value is object {
  return typeof value === 'object' && value !== null && typeof (value as { encode?: unknown }).encode === 'function';
}

/** Every key of `json` names a field of `message` (proto name or JSON name), down through the message fields. */
function only_fields(json: unknown, message: object): boolean {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false;
  const fields = new Map<string, unknown>();
  for (const [name, field] of Object.entries(message)) {
    fields.set(name, field);
    fields.set(json_key(name), field);
  }
  for (const [key, raw] of Object.entries(json)) {
    if (!fields.has(key)) return false;
    const field = fields.get(key);
    if (is_message(field) && !only_fields(raw, field)) return false;
    if (Array.isArray(field) && Array.isArray(raw)) {
      for (let i = 0; i < field.length; i++) if (is_message(field[i]) && !only_fields(raw[i], field[i] as object)) return false;
    }
  }
  return true;
}
