import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { decode_user_state, find_content_kind } from '../dev/user_state.ts';

type JsonValue = { to_json(): unknown };

function core_kind(is_list: boolean): CoreContract.KindInfo {
  const kind = CoreContract.KINDS.find((k) => k.store === 'user_state' && k.is_list === is_list);
  if (kind === undefined) throw new Error(`base proto has no ${is_list ? 'list' : 'single'} UserState kind`);
  return kind;
}

/** A core kind posing as a content kind of another name, for the kind rules alone. */
function as_content(kind: CoreContract.KindInfo, name: string): CoreContract.KindInfo {
  return { ...kind, name };
}

describe('cheat UserState kind rules', () => {
  const list = as_content(core_kind(true), 'ContentList');
  const single = as_content(core_kind(false), 'ContentSingle');
  const game = [list, single];

  it('takes content UserState kinds only', () => {
    expect(find_content_kind(game, CoreContract.KINDS, 'ContentList', 3n)).toBe(list);
    expect(find_content_kind(game, CoreContract.KINDS, 'ContentSingle', 0n)).toBe(single);
    expect(find_content_kind(game, CoreContract.KINDS, 'Unknown', 0n)).toBeNull();
    for (const kind of CoreContract.KINDS) expect(find_content_kind([...game, kind], CoreContract.KINDS, kind.name, 0n)).toBeNull();
    const server_state = { ...single, name: 'ContentServer', store: 'server_state' as const };
    expect(find_content_kind([server_state], CoreContract.KINDS, 'ContentServer', 0n)).toBeNull();
  });

  it('takes item ID 0 only for a single kind', () => {
    expect(find_content_kind(game, CoreContract.KINDS, 'ContentSingle', 1n)).toBeNull();
  });

  it('decodes proto3 JSON of the kind, and rejects bad JSON, other fields and a list id other than the item ID', () => {
    const value = new (list.kind_class as unknown as new () => JsonValue)();
    (value as unknown as { id: bigint }).id = 7n;
    const json = JSON.stringify(value.to_json());
    const decoded = decode_user_state(list, 7n, json) as JsonValue | null;
    expect(decoded).not.toBeNull();
    expect(decoded?.to_json()).toEqual(value.to_json());
    expect(decode_user_state(list, 8n, json)).toBeNull();
    expect(decode_user_state(list, 7n, '{"id": "7"')).toBeNull();
    expect(decode_user_state(list, 7n, '{"id": "7", "no_such_field": 1}')).toBeNull();
    expect(decode_user_state(list, 7n, '[]')).toBeNull();
  });
});
