/**
 * The content `register` of the shared counter tests of `concurrency.test.ts`, for a test server, its peers and its
 * peer processes (`counter_peer`): the core test defaults and a `RunCoreTest` handler that locks the
 * `CloneBossGameState` row of `COUNTER_KEY` with content's `storage.lock_game_row`, reads its `hp` and writes `hp` + 1.
 * The handler refuses the request with `GAME_ERROR_CORE_TEST` after the write when `refused(request ID)` is true, so
 * that write is rolled back with the request. In the process that runs it, the handler keeps the `hp` it read for each
 * request ID in `read_before`.
 */
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { PeerRegister } from '../../testing/dev/index.ts';
import { core_test_register } from '../../testing/dev/runner_input.ts';
import type { RequestCtx, StorageContent } from '../index.ts';

export const COUNTER_KEY = 1n;

interface RegisterCore {
  readonly storage: StorageContent;
  readonly routing: { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
}

/** True for a request ID (lower case UUID v4) that starts with `0` to `3`: about a quarter of random request IDs. */
export function refused(request_id: string): boolean {
  return request_id < '4';
}

/** The counter value each `RunCoreTest` of this process read under the row lock, by request ID: the last run's. */
export const read_before = new Map<string, bigint>();

export function counter_register(core: Readonly<Record<string, unknown>>): void {
  const { storage, routing } = core as unknown as RegisterCore;
  routing.register_handler('RunCoreTest', (ctx) => {
    storage.lock_game_row(ctx, 'game_state', [GameContract.CloneBossGameState, COUNTER_KEY]);
    const row = storage.get_game_state(ctx, GameContract.CloneBossGameState, COUNTER_KEY) as GameContract.CloneBossGameState | null;
    const before = row?.hp ?? 0n;
    const next = new GameContract.CloneBossGameState();
    next.key = COUNTER_KEY;
    next.hp = before + 1n;
    storage.put_game_state(ctx, next, 0n);
    read_before.set(ctx.request_id, before);
    return refused(ctx.request_id) ? GameContract.GameError.GAME_ERROR_CORE_TEST : new GameContract.RunCoreTestResponse();
  });
  core_test_register(core, ['RunCoreTest']);
}

export const counter_peer: PeerRegister = () => counter_register;
