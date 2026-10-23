import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx, StorageContent } from '../../storage/index.ts';
import { game_row_lock_id, hold_game_row_lock, hold_lock_key, login, send, start_test_server, stop_test_server, until_blocked_by } from '../dev/index.ts';
import { core_test_register } from '../dev/runner_input.ts';
import { error_code, real_wait } from './helpers.ts';

interface RegisterCore {
  readonly storage: StorageContent;
  readonly routing: { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
}

/** `RunCoreTest` locks the `CoreTestGameState` row of key 1 with content's `storage.lock_game_row`, which throws on a lock failure. */
function register(core: Readonly<Record<string, unknown>>): void {
  const { storage, routing } = core as unknown as RegisterCore;
  routing.register_handler('RunCoreTest', (ctx) => {
    storage.lock_game_row(ctx, 'game_state', [GameContract.CoreTestGameState, 1n]);
    return new GameContract.RunCoreTestResponse();
  });
  core_test_register(core, ['RunCoreTest']);
}

describe('hold_game_row_lock', () => {
  it('a request that locks the held game row is INTERNAL, and the same request after the release is processed', async () => {
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, { 'storage.userLockWaitMs': 200 }, register);
    try {
      const session = await login(server, 'holder');
      const release = await hold_game_row_lock(server, 'game_state', [GameContract.CoreTestGameState, 1n]);
      let held;
      try {
        held = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
      } finally {
        await release();
      }
      expect(error_code(held)).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
      expect(error_code(await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest()))).toBe(0);
    } finally {
      await stop_test_server(server);
    }
  });

  it('holds the lock that lock_game_row takes for a game_state row, and rejects a game_state key storage rejects', async () => {
    const register_game_state = (core: Readonly<Record<string, unknown>>): void => {
      const { storage, routing } = core as unknown as RegisterCore;
      routing.register_handler('RunCoreTest', (ctx) => {
        storage.lock_game_row(ctx, 'game_state', [GameContract.CoreTestGameState, 7n]);
        return new GameContract.RunCoreTestResponse();
      });
      core_test_register(core, ['RunCoreTest']);
    };
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, { 'storage.userLockWaitMs': 200 }, register_game_state);
    try {
      await expect(hold_game_row_lock(server, 'game_state', [GameContract.CoreTestGameState, -1n])).rejects.toThrow();
      await expect(hold_game_row_lock(server, 'game_state', [GameContract.CoreTestGameState])).rejects.toThrow();
      const session = await login(server, 'game_state_holder');
      const release = await hold_game_row_lock(server, 'game_state', [GameContract.CoreTestGameState, 7n]);
      let held;
      try {
        held = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
      } finally {
        await release();
      }
      expect(error_code(held)).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
      expect(error_code(await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest()))).toBe(0);
    } finally {
      await stop_test_server(server);
    }
  });

  it('holds on PostgreSQL the same lock as hold_lock_key of the row lock ID, each waiting for the other', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    try {
      const row = [GameContract.CoreTestGameState, 3n];
      const holder = await hold_lock_key(server, game_row_lock_id('game_state', row));
      const pending = hold_game_row_lock(server, 'game_state', row);
      await until_blocked_by(server, holder.pid);
      await holder.release();
      const release = await pending;
      const waiter = hold_lock_key(server, game_row_lock_id('game_state', row));
      let settled = false;
      void waiter.then(() => (settled = true), () => (settled = true));
      await real_wait(200);
      expect(settled).toBe(false);
      await release();
      await (await waiter).release();
    } finally {
      await stop_test_server(server);
    }
  }, 60_000);
});
