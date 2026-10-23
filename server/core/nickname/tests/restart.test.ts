/**
 * A restart that changes only game settings `nicknameUnique`. `restart_test_server` keeps the settings overrides of a
 * test server, so this test makes the two server instances with `routing.create_server` on one test DB and calls the
 * module objects its `register` gets. Both instances set `nickname.changeCooldownMs` to 0, so a change after the
 * restart is out of the cooldown without a test clock.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { create_server } from '../../routing/index.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { new_core_test_server_input, type CoreTestServerInput } from '../../testing/dev/index.ts';
import { ItemChangeResult } from '../../item-ledger/index.ts';
import { content_register, CoreError, COST_ITEM, id_value, in_user_transaction, type Core } from './helpers.ts';

interface Instance {
  start(): Promise<number | string>;
  stop(): Promise<void>;
  modules(): ReadonlyMap<string, unknown>;
}

interface Running {
  readonly instance: Instance;
  readonly core: Core;
}

/** A server instance on the test DB of `input` whose settings overrides are `nicknameUnique` and a 0 `nickname.changeCooldownMs`. */
async function start_instance(input: CoreTestServerInput, secret_file: string, unique: boolean): Promise<Running> {
  const kept: { core: Core | null } = { core: null };
  const instance = create_server({
    args: { env: 'LOCAL', port: 0, matchmaker: false, db: input.database.db_argument, secret_file },
    server_modules: input.server_modules,
    data_folder: input.data_folder,
    core_settings: input.settings,
    game_settings: {},
    register: content_register({ reject_nickname_cost: 0 }, (c) => {
      kept.core = c;
    }),
    dev: true,
    register_dev: input.registerDev,
    settings_overrides: { nicknameUnique: unique, 'nickname.changeCooldownMs': 0 },
    log_writer: () => undefined,
  }) as Instance;
  const started = await instance.start();
  expect(typeof started).toBe('number');
  if (kept.core === null) throw new Error('register was not called');
  // Content `register(core)` gets only the member `content` of `storage`; the test uses the module object.
  return { instance, core: { ...kept.core, storage: instance.modules().get('storage') as Storage } };
}

async function new_user(core: Core): Promise<bigint> {
  const user_id = await core.storage.run_game_transaction((tx) => core.storage.create_user(tx));
  if (user_id === 'FAILED') throw new Error('create_user ended with FAILED');
  return user_id;
}

/** `SetNickname` in a request transaction of `user_id`: 0 on success, else the failure code. */
async function set_nickname(core: Core, user_id: bigint, nickname: string): Promise<number> {
  const request = new CoreContract.SetNicknameRequest();
  request.nickname = nickname;
  const fields = { request_name: 'core/SetNickname', request_id: randomUUID(), silent: false, retry: true, session_id: '', client_version: '', platform: '' };
  const result = await core.storage.run_request_transaction(user_id, fields, (ctx: RequestCtx) => core.nickname.SetNickname(ctx, request));
  if (result instanceof CoreContract.SetNicknameResponse) return 0;
  if (typeof result === 'number') return result;
  throw new Error(`SetNickname ended with ${result}`);
}

/** Adds `amount` of the `nickname_cost` item to `user_id` in an out-of-request change. */
async function add_gems(core: Core, user_id: bigint, amount: bigint): Promise<void> {
  const cost = new CoreContract.ItemAmount();
  cost.item_id = id_value(COST_ITEM);
  cost.amount = amount;
  expect(await in_user_transaction(core, user_id, (ctx) => core['item-ledger'].add_items(ctx, [cost], {}))).toBe(ItemChangeResult.OK);
}

function name_rows(core: Core): unknown[] {
  return core.storage.read_db().query('SELECT user_id, normalized, nickname FROM nickname_name ORDER BY user_id', []);
}

describe('nicknameUnique restart', () => {
  it('a restart that changes only nicknameUnique starts and keeps the nickname_name rows; users who shared a normalized nickname keep it and can change it to the same normalized nickname, and a third user is NICKNAME_TAKEN', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'nickname-restart-'));
    const input = await new_core_test_server_input();
    const secret_file = join(folder, 'secrets.json');
    writeFileSync(secret_file, JSON.stringify(input.secrets.file));
    try {
      const first = await start_instance(input, secret_file, false);
      const [a, b, c] = [await new_user(first.core), await new_user(first.core), await new_user(first.core)];
      expect(await set_nickname(first.core, a, 'Twin')).toBe(0);
      expect(await set_nickname(first.core, b, 'TWIN')).toBe(0);
      const rows = name_rows(first.core);
      expect(rows).toHaveLength(2);
      await first.instance.stop();

      const second = await start_instance(input, secret_file, true);
      try {
        expect(name_rows(second.core)).toEqual(rows);
        expect(await set_nickname(second.core, c, 'twin')).toBe(CoreError.CORE_ERROR_NICKNAME_TAKEN);
        const names = await in_user_transaction(second.core, c, (ctx) => second.core.nickname.get_nicknames(ctx, [a, b]));
        expect(names).toEqual([
          { user_id: a, nickname: 'Twin' },
          { user_id: b, nickname: 'TWIN' },
        ]);
        // A change to the same normalized nickname skips the duplicate check, though b has it too, and moves no row.
        await add_gems(second.core, a, 10n);
        expect(await set_nickname(second.core, a, 'T win')).toBe(0);
        expect(name_rows(second.core)).toEqual([
          { user_id: a, normalized: 'twin', nickname: 'T win' },
          { user_id: b, normalized: 'twin', nickname: 'TWIN' },
        ]);
      } finally {
        await second.instance.stop();
      }
    } finally {
      await input.drop();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
