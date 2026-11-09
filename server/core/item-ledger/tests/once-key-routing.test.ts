/**
 * A content `once_key` with a core `once_key` prefix through `routing` (`## error` row "`once_key` passed by content
 * code that starts with a core `once_key` prefix", `## test` "`add_items` called by content code with `once_key`
 * `shop:1`"): the request is `INTERNAL`, the one `error` log is `routing`'s unhandled exception log and item-ledger
 * leaves none, and the balance, history and `once_key` table stay the same.
 */
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { DbHandle, RequestCtx } from '../../storage/index.ts';
import { core_test_register, login, read_logs, read_user_state, send, start_test_server, stop_test_server, type TestServer } from '../../testing/dev/index.ts';
import type { HistoryRow, ItemLedgerContent } from '../index.ts';
import { ONCE_KEY_TABLE } from '../history.ts';
import { amount, id } from './helpers.ts';

/** The `once_key` the next `RunCoreTest` passes to content `add_items` of one `[gold]`. */
let once_key = '';

function register(given: Readonly<Record<string, unknown>>): void {
  const core = given as unknown as {
    readonly 'item-ledger': ItemLedgerContent;
    readonly routing: { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
  };
  core.routing.register_handler('RunCoreTest', (ctx) => {
    // Not caught: a throw is an unhandled exception of the request.
    const result = core['item-ledger'].add_items(ctx, [amount('[gold]', 1n)], { once_key });
    if (result !== 'OK') throw new Error(`add_items: ${String(result)}`);
    return new GameContract.RunCoreTestResponse();
  });
  core_test_register(given, ['RunCoreTest']);
}

function module_of(server: TestServer, name: string): unknown {
  const module = server.running().instance.modules().get(name);
  if (module === undefined) throw new Error(`the server instance has no ${name} module`);
  return module;
}

/** The committed `[gold]` balance of the user (no row is 0). */
async function gold(server: TestServer, user_id: bigint): Promise<bigint> {
  const entry = (await read_user_state(server, user_id)).find((s) => s.kind === 'ItemBalanceUserState' && s.item_id === BigInt(id('[gold]')));
  return (entry?.value as CoreContract.ItemBalanceUserState | undefined)?.amount ?? 0n;
}

function history(server: TestServer, user_id: bigint): readonly HistoryRow[] {
  const ledger = module_of(server, 'item-ledger') as { list_history(user_id: bigint, from: bigint, to: bigint, after_seq: bigint, max_rows: number): readonly HistoryRow[] };
  return ledger.list_history(user_id, 0n, 2n ** 62n, 0n, 1000);
}

function once_key_rows(server: TestServer, user_id: bigint): number {
  const db = (module_of(server, 'storage') as { read_db(): DbHandle }).read_db();
  return db.query(`SELECT once_key FROM ${ONCE_KEY_TABLE} WHERE user_id = $1`, [user_id]).length;
}

/**
 * The log lines of one request: its `error` kind lines, its `request` line (level `error` for `INTERNAL`) and the
 * `core` lines of item-ledger.
 */
function request_logs(server: TestServer, request_id: string): { errors: Record<string, unknown>[]; request: Record<string, unknown>[]; ledger: Record<string, unknown>[] } {
  const lines = read_logs(server).filter((line) => line.request_id === request_id);
  return {
    errors: lines.filter((line) => line.kind === 'error'),
    request: lines.filter((line) => line.kind === 'request'),
    ledger: lines.filter((line) => line.module === 'item-ledger'),
  };
}

describe('content once_key with a core once_key prefix through routing', () => {
  it('add_items by content with once_key shop:1 that the handler does not catch: INTERNAL, one error log by routing and none by item-ledger, and the balance, history and once_key table stay the same', async () => {
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register);
    try {
      const session = await login(server, 'once_key_prefix_user');
      once_key = 'shop:1';
      const refused = randomUUID();
      const sent = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest(), refused);
      expect(sent.envelope.error?.code).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
      const logs = request_logs(server, refused);
      expect(logs.errors.map((line) => [line.level, line.message])).toEqual([['error', 'unhandled exception']]);
      expect(logs.request.map((line) => line.error_code)).toEqual([CoreContract.CoreError.CORE_ERROR_INTERNAL]);
      expect(typeof logs.errors[0]?.stack_trace === 'string' && logs.errors[0].stack_trace !== '').toBe(true);
      expect(logs.ledger).toEqual([]);
      expect(await gold(server, session.user_id)).toBe(0n);
      expect(history(server, session.user_id)).toEqual([]);
      expect(once_key_rows(server, session.user_id)).toBe(0);

      // The same reads see a change: a content once_key without a core prefix applies through the same handler.
      once_key = 'content:1';
      const applied = randomUUID();
      const ok = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest(), applied);
      expect(ok.envelope.error ?? null).toBeNull();
      expect(request_logs(server, applied).errors).toEqual([]);
      expect(await gold(server, session.user_id)).toBe(1n);
      expect(history(server, session.user_id).map((h) => [h.item_id, h.delta, h.source])).toEqual([[id('[gold]'), 1n, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_REQUEST]]);
      expect(once_key_rows(server, session.user_id)).toBe(1);
    } finally {
      await stop_test_server(server);
    }
  });
});
