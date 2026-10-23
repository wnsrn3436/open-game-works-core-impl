/** The test helpers of `helpers.ts` that stand in for `storage` behavior. */
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx, StorageContent } from '../../storage/index.ts';
import { core_test_register, login, send, start_test_server, stop_test_server } from '../../testing/dev/index.ts';
import { hold_until_waiter, stop_all } from './helpers.ts';

interface RegisterCore {
  readonly storage: StorageContent;
  readonly routing: { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
}

/** `RunCoreTest` locks the `CoreTestGameState` row of key 7 with content's `storage.lock_game_row`. */
function register(core: Readonly<Record<string, unknown>>): void {
  const { storage, routing } = core as unknown as RegisterCore;
  routing.register_handler('RunCoreTest', (ctx) => {
    storage.lock_game_row(ctx, 'game_state', [GameContract.CoreTestGameState, 7n]);
    return new GameContract.RunCoreTestResponse();
  });
  core_test_register(core, ['RunCoreTest']);
}

afterEach(async () => {
  await stop_all();
});

describe('hold_until_waiter', () => {
  it('holds the lock lock_game_row takes for a game_state row and lets the waiting request take it (PostgreSQL)', async () => {
    const server = await start_test_server(undefined, 'postgresql', undefined, undefined, undefined, { 'storage.userLockWaitMs': 10_000 }, register);
    try {
      await expect(hold_until_waiter(server, 'game_state', [GameContract.CoreTestGameState, -1n])).rejects.toThrow();
      const session = await login(server, 'until_waiter');
      const { released } = await hold_until_waiter(server, 'game_state', [GameContract.CoreTestGameState, 7n]);
      const sent = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
      // `released` rejects when no transaction waited for the held lock: a lock of another key would not hold the request.
      await released;
      expect(sent.envelope.error?.code ?? 0).toBe(0);
    } finally {
      await stop_test_server(server);
    }
  });
});
