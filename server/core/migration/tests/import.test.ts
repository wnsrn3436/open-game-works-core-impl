import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { quest, QuestUserState } from '../../storage/tests/kinds.ts';
import { CURRENT } from './contract.ts';
import { CLONE_AVAILABLE, new_user, request, row, server, snapshot, stop_all, stored, type Server } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const Q = 'quest_user_state';

interface AdminHandler {
  prepare?: ((input: Record<string, unknown>, body: Uint8Array | null) => unknown) | null;
  handler(input: Record<string, unknown>, tx: unknown, prepare: unknown, body: Uint8Array | null): unknown;
}

/**
 * `import_user_snapshot` the way `admin-api` runs a binary body operation with `user_target`: the prepare function,
 * then the handler function in the target user's out-of-request change.
 */
async function import_snapshot(s: Server, target_user_id: bigint, body: Uint8Array): Promise<unknown> {
  const operation = s.modules['user-snapshot-clone']?.['import_user_snapshot'] as AdminHandler;
  const prepared: unknown = await operation.prepare?.({ target_user_id }, body);
  if (typeof prepared === 'string') return prepared;
  let output: unknown = null;
  const result = await s.storage.run_user_transaction(target_user_id, (ctx) => {
    output = operation.handler({ target_user_id }, ctx, prepared, body);
    return typeof output === 'string' ? CoreContract.CoreError.CORE_ERROR_INTERNAL : 'pass';
  });
  if (result !== 'COMMITTED' && typeof output !== 'string') throw new Error(`import_user_snapshot: ${result}`);
  return output;
}

describe('snapshot import', () => {
  it.skipIf(!CLONE_AVAILABLE)('the first request of a user whose lower contract version records came in by user-snapshot-clone.import_user_snapshot reads the converted values', async () => {
    const s = await server({ clone: true });
    const user = await new_user(s);
    const records = [row('user_state', Q, 1n, 1n, quest(1n, 5n))];
    const body = new TextEncoder().encode(JSON.stringify(snapshot(records, { source_user_id: '77', user_created_at: '1700000000000' })));
    const output = await import_snapshot(s, user, body);
    expect(Number((output as Record<string, unknown>)['replaced_records'])).toBe(1);
    expect(stored(s, 'user_state', user, Q, 1n)?.contract_version).toBe(1n);
    expect(await request(s, user, (ctx) => s.storage.get_state(ctx, QuestUserState, 1n))).toEqual(quest(1n, 30n));
    expect(stored(s, 'user_state', user, Q, 1n)).toEqual({ value: quest(1n, 30n).encode(), contract_version: CURRENT });
  });
});
