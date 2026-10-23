import { boss, BossGameState, profile, quest, QuestUserState, wallet } from '../../storage/tests/kinds.ts';
import { DELETE } from '../index.ts';
import { CURRENT, default_converters } from './contract.ts';
import { CLONE_AVAILABLE, dump, new_user, records_sha256, row, seed, seed_game, server, snapshot, stop_all } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const Q = 'quest_user_state';
const USER = { source_user_id: '77', user_created_at: '1700000000000' };

describe.skipIf(!CLONE_AVAILABLE)('migrate_snapshot', () => {
  it('returns a result for every record and does not change the DB', async () => {
    const s = await server({ clone: true });
    const user = await new_user(s);
    await seed(s, user, [row('user_state', Q, 1n, 1n, quest(1n, 1n))]);
    await seed_game(s, [row('game_state', 'boss_game_state', 1n, 1n, boss(1n, 1n))]);
    const before = dump(s);
    const module_row = { table: 'mailbox_mail', key: '["5"]', contract_version: 0n, value: new TextEncoder().encode('{"mail_id":"5"}') };
    const output = s.dev.migrate_snapshot(
      snapshot([row('server_state', 'wallet_server_state', 0n, 1n, wallet(1n)), row('user_state', Q, 1n, 1n, quest(1n, 1n)), module_row], USER),
    );
    // Records come in the snapshot's (table, key) byte order.
    expect(output).toEqual([
      { table: 'mailbox_mail', key: '["5"]', from_version: 0, result: 'UNCHANGED', error: null },
      { table: 'server_state', key: 'wallet_server_state/0', from_version: 1, result: 'OK', error: null },
      { table: 'user_state', key: `${Q}/1`, from_version: 1, result: 'OK', error: null },
    ]);
    expect(dump(s)).toBe(before);
  });

  it('a record a converter applies to is OK; a current version record and a lower version record without a registered converter are UNCHANGED', async () => {
    const s = await server({ clone: true });
    const output = s.dev.migrate_snapshot(
      snapshot(
        [
          row('user_state', Q, 1n, 2n, quest(1n, 1n)),
          row('user_state', Q, 2n, CURRENT, quest(2n, 1n)),
          row('user_state', 'profile_user_state', 0n, 1n, profile(1n)),
        ],
        USER,
      ),
    );
    expect(output).toEqual([
      { table: 'user_state', key: 'profile_user_state/0', from_version: 1, result: 'UNCHANGED', error: null },
      { table: 'user_state', key: `${Q}/1`, from_version: 2, result: 'OK', error: null },
      { table: 'user_state', key: `${Q}/2`, from_version: 3, result: 'UNCHANGED', error: null },
    ]);
  });

  it('a record with a very low contract version gets only the registered converters and is OK', async () => {
    const s = await server({ clone: true });
    const lowest = -BigInt(Number.MAX_SAFE_INTEGER);
    const output = s.dev.migrate_snapshot(snapshot([row('user_state', Q, 1n, lowest, quest(1n, 1n))], USER));
    expect(output).toEqual([{ table: 'user_state', key: `${Q}/1`, from_version: -Number.MAX_SAFE_INTEGER, result: 'OK', error: null }]);
  });

  it('a record a converter deletes is DELETED', async () => {
    const fallback = default_converters()['QuestUserState:2'];
    const s = await server({ clone: true, converters: { 'QuestUserState:2': (item, data) => ((item as QuestUserState).id === 9n ? DELETE : (fallback?.(item, data) ?? item)) } });
    const output = s.dev.migrate_snapshot(snapshot([row('user_state', Q, 9n, 1n, quest(9n, 1n))], USER));
    expect(output).toEqual([{ table: 'user_state', key: `${Q}/9`, from_version: 1, result: 'DELETED', error: null }]);
  });

  it('applies the converter of the kind to a lower version game_state record of a game state snapshot, and a converter that throws makes it FAILED', async () => {
    const s = await server({
      clone: true,
      converters: {
        'BossGameState:1': (item) => {
          const b = item as BossGameState;
          if (b.key === 2n) throw new Error('converter bug');
          b.hp += 7n;
          return b;
        },
      },
    });
    const output = s.dev.migrate_snapshot(
      snapshot([row('game_state', 'boss_game_state', 1n, 1n, boss(1n, 1n)), row('game_state', 'boss_game_state', 2n, 1n, boss(2n, 1n))], null),
    );
    expect(output).toEqual([
      { table: 'game_state', key: 'boss_game_state/1', from_version: 1, result: 'OK', error: null },
      { table: 'game_state', key: 'boss_game_state/2', from_version: 1, result: 'FAILED', error: 'from version 1: the converter threw: converter bug' },
    ]);
  });

  it('is bad_request for a snapshot that breaks the snapshot format', async () => {
    const s = await server({ clone: true });
    const good = snapshot([row('user_state', Q, 1n, 1n, quest(1n, 1n))], USER);
    const records = good['records'] as Record<string, unknown>[];
    const with_records = (changed: Record<string, unknown>[]): Record<string, unknown> => ({ ...good, records: changed, sha256: records_sha256(changed) });
    expect(Array.isArray(s.dev.migrate_snapshot(good))).toBe(true);
    // The format check is user-snapshot-clone.check_snapshot's: a few violations show that migrate_snapshot uses it.
    const broken: Record<string, unknown>[] = [
      { ...good, sha256: '0'.repeat(64) },
      { ...good, format: 2 },
      { ...good, extra: true },
      Object.fromEntries(Object.entries(good).filter(([k]) => k !== 'user_created_at')),
      with_records(records.map((r) => ({ ...r, contract_version: '1' }))),
    ];
    for (const value of broken) expect(s.dev.migrate_snapshot(value)).toBe('bad_request');
    expect(s.dev.migrate_snapshot([])).toBe('bad_request');
  });
});
