/** The `user_state` and `server_state` JSON of `get_user` and `export_personal_data`. */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';
import type { AdminOutput } from './types.ts';

/** A UserState or server state kind value: the generated class has the proto3 JSON method. */
interface JsonKind {
  to_json(): unknown;
}

function json_of(value: unknown): unknown {
  return (value as JsonKind).to_json();
}

/**
 * The user's kinds of one store, keyed by the kind name in snake_case: a single kind as its proto3 JSON object, a
 * list kind as the array of its items. A kind with no value is left out.
 */
export function read_states(storage: Pick<Storage, 'get_state' | 'list_state'>, ctx: RequestCtx, store: 'user_state' | 'server_state'): AdminOutput {
  const out: Record<string, unknown> = {};
  for (const kind of [...CoreContract.KINDS, ...GameContract.KINDS]) {
    if (kind.store !== store) continue;
    if (kind.is_list) {
      const items = storage.list_state(ctx, kind.kind_class);
      if (items.length > 0) out[kind.column] = items.map(json_of);
    } else {
      const value = storage.get_state(ctx, kind.kind_class, 0n);
      if (value !== null) out[kind.column] = json_of(value);
    }
  }
  return out;
}
