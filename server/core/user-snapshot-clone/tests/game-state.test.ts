import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { Storage } from '../../storage/index.ts';
import { hold_game_row_lock, read_logs, stop_test_server } from '../../testing/dev/index.ts';
import type { GameStateSnapshot, SnapshotRecord } from '../snapshot.ts';
import {
  admin,
  dumpDb,
  encodeJson,
  exportGameState,
  imported,
  importGameState,
  jsonParses,
  newUser,
  startServer,
  withFields,
  withRecords,
  type Core,
  type Json,
  type Server,
} from './helpers.ts';

const BOSS = 'CloneBossGameState';

function column(name: string): string {
  const info = GameContract.KINDS.find((k) => k.name === name);
  if (info === undefined) throw new Error(`no game state kind ${name}`);
  return info.column;
}

function boss(key: bigint, hp: bigint): GameContract.CloneBossGameState {
  const value = new GameContract.CloneBossGameState();
  value.key = key;
  value.hp = hp;
  value.damages = [hp, 1n];
  return value;
}

/** Writes game state rows from a user transaction. */
async function put(server: Server, core: Core, values: readonly { encode(): Uint8Array }[]): Promise<void> {
  const user = await newUser(server, 'writer');
  const result = await core.storage.run_user_transaction(user.user_id, (ctx) => {
    for (const value of values) core.storage.put_game_state(ctx, value, 0n);
    return 'pass';
  });
  expect(result).toBe('COMMITTED');
}

/** Committed `game_state` rows of a kind as records, key ascending. */
function records(core: Core, name: string): SnapshotRecord[] {
  return core.storage
    .read_db()
    .query('SELECT "key", value, contract_version FROM game_state WHERE kind = $1 ORDER BY "key"', [column(name)])
    .map((r) => ({
      table: 'game_state',
      key: `${column(name)}/${String(r['key'])}`,
      contract_version: Number(r['contract_version']),
      value: Buffer.from(r['value'] as Uint8Array).toString('base64'),
    }));
}

async function setVersion(core: Core, name: string, key: bigint, version: bigint): Promise<void> {
  const result = await core.storage.run_game_transaction((tx) => {
    core.storage.db(tx).query('UPDATE game_state SET contract_version = $1 WHERE kind = $2 AND "key" = $3', [version, column(name), key]);
    return 'done';
  });
  expect(result).toBe('done');
}

/** Imports `snapshot` and expects a failure status with every table row unchanged. */
async function expectRefused(server: Server, core: Core, snapshot: unknown, status: number, target_key?: bigint): Promise<void> {
  const before = dumpDb(core);
  expect((await importGameState(server, snapshot, target_key)).status).toBe(status);
  expect(dumpDb(core)).toEqual(before);
}

function keysOf(snapshot: GameStateSnapshot): string[] {
  return snapshot.records.map((r) => r.key);
}

describe('game state snapshot', () => {
  let server: Server;
  let core: Core;

  beforeEach(async () => {
    ({ server, core } = await startServer({ 'user-snapshot-clone.maxSampleCount': 10 }));
  });

  afterEach(async () => {
    await stop_test_server(server);
  });

  it('export_game_state holds the rows of the kind and keys with stored bytes and contract version, skips missing keys and changes nothing', async () => {
    await put(server, core, [boss(1n, 100n), boss(2n, 200n), boss(3n, 300n)]);
    await setVersion(core, BOSS, 2n, 0n);
    const before = dumpDb(core);
    const snapshot = await exportGameState(server, BOSS, [2n, 1n, 99n]);
    expect(dumpDb(core)).toEqual(before);
    expect(snapshot.records).toEqual(records(core, BOSS).filter((r) => r.key !== `${column(BOSS)}/3`));
    expect(snapshot.records[1]?.contract_version).toBe(0);
    expect(Object.keys(snapshot)).not.toContain('source_user_id');
    expect(Object.keys(snapshot)).not.toContain('user_created_at');
  });

  it('export_game_state is bad_request for another kind name, no keys, too many keys, a negative key and a repeated key', async () => {
    for (const body of [
      { kind: 'NoSuchGameState', keys: ['1'] },
      { kind: 'ItemBalanceUserState', keys: ['1'] },
      { kind: BOSS, keys: [] },
      { kind: BOSS, keys: Array.from({ length: 11 }, (_, i) => String(i + 1)) },
      { kind: BOSS, keys: ['-1'] },
      { kind: BOSS, keys: ['1', '1'] },
    ]) {
      expect((await admin(server, 'export_game_state', body)).status).toBe(400);
    }
  });

  it('sample_game_state holds rows of that kind only, no row twice, up to count, and all rows when fewer', async () => {
    await put(server, core, [boss(1n, 1n), boss(2n, 2n), boss(3n, 3n), boss(4n, 4n), boss(5n, 5n)]);
    const raid = new GameContract.CloneRaidGameState();
    raid.key = 7n;
    raid.stage = 3n;
    await put(server, core, [raid]);
    const sample = async (count: number) => {
      const reply = await admin(server, 'sample_game_state', { kind: BOSS, count });
      expect(reply.status).toBe(200);
      return keysOf(reply.json as GameStateSnapshot);
    };
    for (let i = 0; i < 5; i += 1) {
      const keys = await sample(3);
      expect(keys.length).toBe(3);
      expect(new Set(keys).size).toBe(3);
      for (const key of keys) expect(key.startsWith(`${column(BOSS)}/`)).toBe(true);
    }
    expect((await sample(10)).sort()).toEqual([1, 2, 3, 4, 5].map((k) => `${column(BOSS)}/${String(k)}`).sort());
    expect((await admin(server, 'sample_game_state', { kind: BOSS, count: 0 })).status).toBe(400);
    expect((await admin(server, 'sample_game_state', { kind: BOSS, count: 11 })).status).toBe(400);
    expect((await admin(server, 'sample_game_state', { kind: 'NoSuchGameState', count: 1 })).status).toBe(400);
  });

  it('import_game_state writes the rows as the records, and with target_key writes that key with key = target_key', async () => {
    await put(server, core, [boss(1n, 100n), boss(2n, 200n)]);
    await setVersion(core, BOSS, 2n, 0n);
    const snapshot = await exportGameState(server, BOSS, [1n, 2n]);
    await put(server, core, [boss(1n, 1n), boss(2n, 2n)]);
    const output = imported(await importGameState(server, snapshot));
    expect(output.replaced_records).toBe(2);
    expect(output.data_version_matches).toBe(true);
    expect(records(core, BOSS)).toEqual(snapshot.records);

    imported(await importGameState(server, await exportGameState(server, BOSS, [1n]), 50n));
    const user = await newUser(server, 'reader');
    const read = await core.storage.run_rollback_transaction(user.user_id, (ctx) => core.storage.get_game_state(ctx, GameContract.CloneBossGameState, 50n));
    expect(read).toBeInstanceOf(GameContract.CloneBossGameState);
    const value = read as GameContract.CloneBossGameState;
    expect([value.key, value.hp, value.damages]).toEqual([50n, 100n, [100n, 1n]]);
    expect(records(core, BOSS).map((r) => r.key)).toEqual([1, 2, 50].map((k) => `${column(BOSS)}/${String(k)}`));
  });

  it('import_game_state of another data_version succeeds with data_version_matches false and the server data version', async () => {
    await put(server, core, [boss(1n, 100n)]);
    const snapshot = await exportGameState(server, BOSS, [1n]);
    const output = imported(await importGameState(server, withFields(snapshot, { data_version: `${snapshot.data_version}-other` })));
    expect(output.data_version_matches).toBe(false);
    expect(output.data_version).toBe(snapshot.data_version);
  });

  it('import_game_state is bad_request for a record outside game_state, an unknown kind, a key above int64, two records with the same key, and a wrong target_key, changing nothing', async () => {
    await put(server, core, [boss(1n, 100n), boss(2n, 200n)]);
    const snapshot = await exportGameState(server, BOSS, [1n, 2n]);
    const [first] = snapshot.records;
    if (first === undefined) throw new Error('no record');
    const before = dumpDb(core);
    const refused = async (body: Json | GameStateSnapshot, target_key?: bigint) => {
      expect((await importGameState(server, body, target_key)).status).toBe(400);
      expect(dumpDb(core)).toEqual(before);
    };
    await refused(withRecords(snapshot, [{ ...first, table: 'user_state' }]));
    await refused(withRecords(snapshot, [{ ...first, key: 'no_such_game_state/1' }]));
    await refused(withRecords(snapshot, [{ ...first, key: `${column(BOSS)}/-1` }]));
    await refused(withRecords(snapshot, [{ ...first, key: `${column(BOSS)}/9223372036854775808` }]));
    // With target_key the rewritten record goes through the same table and kind checks.
    await refused(withRecords(snapshot, [{ ...first, table: 'user_state' }]), 9n);
    await refused(withRecords(snapshot, [{ ...first, key: 'no_such_game_state/1' }]), 9n);
    await refused(withRecords(snapshot, [{ ...first, key: column(BOSS) }]), 9n);
    await refused(snapshot, 9n);
    await refused(withRecords(snapshot, [first]), -1n);
    await refused({ ...snapshot, source_user_id: '1', user_created_at: '1' });
    // Two records with the same key.
    await refused(withRecords(snapshot, [...snapshot.records, first]));
    // int64 max itself is a key storage takes.
    imported(await importGameState(server, withRecords(snapshot, [{ ...first, key: `${column(BOSS)}/9223372036854775807` }])));
  });

  it('import_game_state refuses a wrong sha256, another app_id, a higher contract version and a higher core version, changing nothing', async () => {
    await put(server, core, [boss(1n, 100n), boss(2n, 200n)]);
    const snapshot = await exportGameState(server, BOSS, [1n, 2n]);
    await put(server, core, [boss(1n, 1n), boss(2n, 2n)]);
    await expectRefused(server, core, withFields(snapshot, { sha256: 'f'.repeat(64) }), 400);
    await expectRefused(server, core, withFields(snapshot, { format: '1' }), 400);
    await expectRefused(server, core, withFields(snapshot, { app_id: `${snapshot.app_id}.other` }), 409);
    await expectRefused(server, core, withFields(snapshot, { contract_version: GameContract.CONTRACT_VERSION + 1 }), 409);
    const higher = snapshot.records.map((r, i) => (i === 1 ? { ...r, contract_version: GameContract.CONTRACT_VERSION + 1 } : r));
    await expectRefused(server, core, withRecords(snapshot, higher), 409);
    const major = Number(snapshot.core_version.split('.')[0]);
    await expectRefused(server, core, withFields(snapshot, { core_version: `${String(major + 1)}.0.0` }), 409);
    // A leading zero names a version no higher than the server's, so only the version form refuses it.
    await expectRefused(server, core, withFields(snapshot, { core_version: `0${snapshot.core_version}` }), 400);
    // The same snapshot is taken.
    imported(await importGameState(server, snapshot));
    expect(records(core, BOSS)).toEqual(snapshot.records);
  });

  it('import_game_state leaves the game_state rows when storing fails, and is 500 internal with an error log', async () => {
    await put(server, core, [boss(1n, 100n), boss(2n, 200n)]);
    const snapshot = await exportGameState(server, BOSS, [1n, 2n]);
    await put(server, core, [boss(1n, 1n), boss(2n, 2n)]);
    // The rows are written, and then the storage call fails: the game tx must not commit them.
    const storage = core.storage as { replace_game_rows: Storage['replace_game_rows'] };
    const original = storage.replace_game_rows;
    storage.replace_game_rows = (tx, rows) => {
      original(tx, rows);
      throw new Error('storing failed');
    };
    const errors = read_logs(server, 'error').length;
    try {
      await expectRefused(server, core, snapshot, 500);
    } finally {
      storage.replace_game_rows = original;
    }
    expect(read_logs(server, 'error').length).toBeGreaterThan(errors);
  });

  it('import_game_state is 500 internal with an error log and leaves the game_state rows when replace_game_rows is FAILED', async () => {
    await put(server, core, [boss(1n, 100n), boss(2n, 200n)]);
    const snapshot = await exportGameState(server, BOSS, [1n, 2n]);
    await put(server, core, [boss(1n, 1n), boss(2n, 2n)]);
    const before = dumpDb(core);
    // A lock wait over the limit after the first row is written: the game tx must not commit it.
    const storage = core.storage as { replace_game_rows: Storage['replace_game_rows'] };
    const original = storage.replace_game_rows;
    storage.replace_game_rows = (tx, rows) => {
      original(tx, rows.slice(0, 1));
      return 'FAILED';
    };
    const errors = read_logs(server, 'error').length;
    let reply;
    try {
      reply = await importGameState(server, snapshot);
    } finally {
      storage.replace_game_rows = original;
    }
    expect(reply.status).toBe(500);
    expect(reply.json).toMatchObject({ error: 'internal' });
    expect(dumpDb(core)).toEqual(before);
    expect(read_logs(server, 'error').length).toBeGreaterThan(errors);
  });

  it('import_game_state is 500 internal and leaves the game_state rows while lock_game_row of a record row is held past the lock wait limit, and imports after the release', async () => {
    await stop_test_server(server);
    ({ server, core } = await startServer({ 'user-snapshot-clone.maxSampleCount': 10, 'storage.userLockWaitMs': 200 }));
    await put(server, core, [boss(1n, 100n), boss(2n, 200n)]);
    const snapshot = await exportGameState(server, BOSS, [1n, 2n]);
    await put(server, core, [boss(1n, 1n), boss(2n, 2n)]);
    const before = dumpDb(core);
    const errors = read_logs(server, 'error').length;
    // The real storage lock of `replace_game_rows`, with no stub: the one content's `lock_game_row(game_state, ...)` takes.
    const release = await hold_game_row_lock(server, 'game_state', [GameContract.CloneBossGameState, 2n]);
    let reply;
    try {
      reply = await importGameState(server, snapshot);
    } finally {
      await release();
    }
    expect(reply.status).toBe(500);
    expect(reply.json).toMatchObject({ error: 'internal' });
    expect(dumpDb(core)).toEqual(before);
    expect(read_logs(server, 'error').length).toBeGreaterThan(errors);
    expect(imported(await importGameState(server, snapshot)).replaced_records).toBe(2);
    expect(records(core, BOSS)).toEqual(snapshot.records);
  });

  it('import_game_state with target_key rewrites the key of a value with a field above 200,000 bytes', async () => {
    await put(server, core, [boss(1n, 100n)]);
    const snapshot = await exportGameState(server, BOSS, [1n]);
    const [first] = snapshot.records;
    if (first === undefined) throw new Error('no record');
    // `damages` of 1s packs one byte per value: a length-delimited field of 250,000 bytes.
    const big = boss(1n, 100n);
    big.damages = Array.from({ length: 250_000 }, () => 1n);
    const value = big.encode();
    expect(value.length).toBeGreaterThan(250_000);
    const body = withRecords(snapshot, [{ ...first, value: Buffer.from(value).toString('base64') }]);
    expect(imported(await importGameState(server, body, 60n)).replaced_records).toBe(1);
    const user = await newUser(server, 'reader');
    const read = await core.storage.run_rollback_transaction(user.user_id, (ctx) => core.storage.get_game_state(ctx, GameContract.CloneBossGameState, 60n));
    expect(read).toBeInstanceOf(GameContract.CloneBossGameState);
    const stored = read as GameContract.CloneBossGameState;
    expect([stored.key, stored.hp, stored.damages.length]).toEqual([60n, 100n, 250_000]);
    expect(stored.damages.every((d) => d === 1n)).toBe(true);
  });

  it('import_game_state audit args hold source_environment, the record keys, sha256 and target_key, not the snapshot', async () => {
    await put(server, core, [boss(1n, 100n)]);
    const snapshot = await exportGameState(server, BOSS, [1n]);
    imported(await importGameState(server, snapshot, 5n));
    const line = read_logs(server, 'audit').find((l) => l['request'] === 'import_game_state');
    expect(line).toBeDefined();
    const args = (line?.['args'] ?? line) as Record<string, unknown>;
    expect(args['source_environment']).toBe(snapshot.source_environment);
    expect(args['keys']).toEqual([`${column(BOSS)}/1`]);
    expect(args['sha256']).toBe(snapshot.sha256);
    expect(String(args['target_key'])).toBe('5');
    expect(Object.keys(args)).not.toContain('kind');
    expect(Object.keys(args)).not.toContain('records');
  });

  it('import_game_state parses a body once for audit_args and prepare', async () => {
    await put(server, core, [boss(1n, 100n)]);
    const body = encodeJson(await exportGameState(server, BOSS, [1n]));
    const operation = core['user-snapshot-clone'].import_game_state;
    const parses = await jsonParses(new TextDecoder().decode(body), async () => {
      const args = operation.audit_args?.({ target_key: 5n }, body);
      const prepared = await operation.prepare?.({ target_key: 5n }, body);
      expect(args?.['sha256']).toBe((prepared as { snapshot: { sha256: string } }).snapshot.sha256);
    });
    expect(parses).toBe(1);
  });

  it('check_snapshot is OK for an exported snapshot of either kind and bad_request for check 2 failures, reading and writing nothing', async () => {
    await put(server, core, [boss(1n, 100n)]);
    const user = await newUser(server, 'checked');
    const game_state = await exportGameState(server, BOSS, [1n]);
    const reply = await admin(server, 'export_user_snapshot', { user_id: String(user.user_id) });
    expect(reply.status).toBe(200);
    const user_snapshot = reply.json as Json;
    const clone = core['user-snapshot-clone'];
    const before = dumpDb(core);
    expect(clone.check_snapshot(user_snapshot, false)).toBe('OK');
    expect(clone.check_snapshot(game_state, true)).toBe('OK');
    expect(clone.check_snapshot(user_snapshot, true)).toBe('bad_request');
    expect(clone.check_snapshot(game_state, false)).toBe('bad_request');
    expect(clone.check_snapshot({ ...game_state, sha256: '0'.repeat(64) }, true)).toBe('bad_request');
    expect(clone.check_snapshot({ ...game_state, format: '1' }, true)).toBe('bad_request');
    expect(clone.check_snapshot({ ...game_state, core_version: '1.2' }, true)).toBe('bad_request');
    expect(clone.check_snapshot({ ...game_state, core_version: `0${game_state.core_version}` }, true)).toBe('bad_request');
    expect(clone.check_snapshot({ ...user_snapshot, core_version: `0${String(user_snapshot['core_version'])}` }, false)).toBe('bad_request');
    expect(clone.check_snapshot([game_state], true)).toBe('bad_request');
    expect(clone.check_snapshot(null, false)).toBe('bad_request');
    expect(dumpDb(core)).toEqual(before);
  });

  it('export_game_state and sample_game_state over maxSnapshotBytes are conflict', async () => {
    const small = await startServer({ 'user-snapshot-clone.maxSnapshotBytes': 300 });
    try {
      await put(small.server, small.core, [boss(1n, 100n), boss(2n, 200n), boss(3n, 300n)]);
      expect((await admin(small.server, 'export_game_state', { kind: BOSS, keys: ['1', '2', '3'] })).status).toBe(409);
      expect((await admin(small.server, 'sample_game_state', { kind: BOSS, count: 3 })).status).toBe(409);
    } finally {
      await stop_test_server(small.server);
    }
  });
});
