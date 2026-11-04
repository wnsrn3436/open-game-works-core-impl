import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { GameTx, RequestCtx } from '../../storage/index.ts';
import { stop_test_server } from '../../testing/dev/index.ts';
import { create_user_snapshot_clone, type AdminOperation, type AdminOutput, type FailureReason } from '../index.ts';
import type { GameStateSnapshot, SnapshotRecord, UserSnapshot } from '../snapshot.ts';
import {
  admin,
  dumpDb,
  exportSnapshot,
  kindInfo,
  newUser,
  recordsOf,
  richUser,
  sessionRows,
  startServer,
  tableNames,
  userRecord,
  userRows,
  withdraw,
  type Core,
  type Json,
  type Server,
  type Session,
} from './helpers.ts';

describe('export_user_snapshot', () => {
  let server: Server;
  let core: Core;

  beforeAll(async () => {
    ({ server, core } = await startServer());
  });

  afterAll(async () => {
    await stop_test_server(server);
  });

  it('holds the included rows with their stored bytes and contract version, and no excluded table row', async () => {
    const source = await richUser(server, core);
    const snapshot = await exportSnapshot(server, source.user_id);
    expect(snapshot.records).toEqual(recordsOf(await userRows(core, source.user_id)));
    const tables = new Set(snapshot.records.map((r) => r.table));
    expect(tables.has('user_state')).toBe(true);
    // The lower-version row is held as stored.
    const consent = snapshot.records.find((r) => r.key === `${kindInfo('ConsentUserState').column}/0`);
    expect(consent?.contract_version).toBe(0);
    // Excluded tables have rows of this user, and none is in the snapshot.
    expect(sessionRows(core, source.user_id).length).toBe(1);
    for (const excluded of ['session_current', 'pending_delta', 'idempotency_response', 'item_ledger_history', 'user', 'game_state', 'user_snapshot_clone_record']) {
      expect(tables.has(excluded)).toBe(false);
    }
  });

  it('leaves every table row as it was, a lower contract version item included', async () => {
    const source = await richUser(server, core);
    const before = dumpDb(core);
    await exportSnapshot(server, source.user_id);
    expect(dumpDb(core)).toEqual(before);
    const consent = core.storage
      .read_db()
      .query('SELECT contract_version FROM user_state WHERE user_id = $1 AND kind = $2', [source.user_id, kindInfo('ConsentUserState').column]);
    expect(consent.map((r) => BigInt(String(r['contract_version'])))).toEqual([0n]);
    expect(tableNames(core)).toContain('user_snapshot_clone_record');
  });

  it('keeps the types of the snapshot table', async () => {
    const source = await richUser(server, core);
    const snapshot = (await exportSnapshot(server, source.user_id)) as unknown as Json;
    expect(snapshot['format']).toBe(1);
    expect(typeof snapshot['app_id']).toBe('string');
    expect(snapshot['source_environment']).toBe('LOCAL');
    expect(snapshot['source_user_id']).toBe(String(source.user_id));
    expect(snapshot['user_created_at']).toBe(String(userRecord(core, source.user_id).created_at));
    expect(snapshot['exported_at']).toMatch(/^[0-9]+$/);
    expect(snapshot['contract_version']).toBe(GameContract.CONTRACT_VERSION);
    expect(typeof snapshot['data_version']).toBe('string');
    expect(snapshot['core_version']).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    expect(snapshot['sha256']).toMatch(/^[0-9a-f]{64}$/);
    for (const record of snapshot['records'] as Json[]) {
      expect(Object.keys(record).sort()).toEqual(['contract_version', 'key', 'table', 'value']);
      expect(Number.isInteger(record['contract_version'])).toBe(true);
      expect(typeof record['value']).toBe('string');
    }
  });

  it('is not_found for a missing user and a withdrawn user', async () => {
    expect((await admin(server, 'export_user_snapshot', { user_id: '999999999' })).status).toBe(404);
    const user = await newUser(server);
    await withdraw(user);
    expect((await admin(server, 'export_user_snapshot', { user_id: String(user.user_id) })).status).toBe(404);
  });
});

describe('export_user_snapshot over maxSnapshotBytes', () => {
  it('is conflict', async () => {
    const { server, core } = await startServer({ 'user-snapshot-clone.maxSnapshotBytes': 400 });
    try {
      const source = await richUser(server, core);
      const reply = await admin(server, 'export_user_snapshot', { user_id: String(source.user_id) });
      expect(reply.status).toBe(409);
      expect(reply.json).toEqual({ error: 'conflict' });
    } finally {
      await stop_test_server(server);
    }
  });
});

describe('sample_user_ids', () => {
  it('returns no withdrawn user and no user twice', async () => {
    const { server } = await startServer();
    try {
      const users: Session[] = [];
      for (let i = 0; i < 6; i += 1) users.push(await newUser(server, 'sample'));
      const [, first, , , second] = users;
      if (first === undefined || second === undefined) throw new Error('no users');
      await withdraw(first);
      await withdraw(second);
      const live = new Set(users.filter((u) => u !== first && u !== second).map((u) => String(u.user_id)));
      const ids = async (count: number) => {
        const reply = await admin(server, 'sample_user_ids', { count });
        expect(reply.status).toBe(200);
        return (reply.json as { user_ids: string[] }).user_ids;
      };
      const all = await ids(10);
      expect(new Set(all)).toEqual(live);
      expect(all.length).toBe(live.size);
      for (let i = 0; i < 10; i += 1) {
        const some = await ids(2);
        expect(some.length).toBe(2);
        expect(new Set(some).size).toBe(2);
        for (const id of some) expect(live.has(id)).toBe(true);
      }
    } finally {
      await stop_test_server(server);
    }
  });

  it('picks with one storage.sample_users call of count and reads no user page with scan_users', async () => {
    const { server, core } = await startServer();
    const storage = core.storage as { sample_users: Core['storage']['sample_users']; scan_users: Core['storage']['scan_users'] };
    const sample = storage.sample_users;
    const scan = storage.scan_users;
    const counts: number[] = [];
    let scans = 0;
    storage.sample_users = (db, max) => {
      counts.push(max);
      return sample(db, max);
    };
    storage.scan_users = (...args) => {
      scans += 1;
      return scan(...args);
    };
    try {
      for (let i = 0; i < 4; i += 1) await newUser(server, 'one_query');
      const reply = await admin(server, 'sample_user_ids', { count: 3 });
      expect(reply.status).toBe(200);
      expect((reply.json as { user_ids: string[] }).user_ids).toHaveLength(3);
      expect(counts).toEqual([3]);
      expect(scans).toBe(0);
    } finally {
      storage.sample_users = sample;
      storage.scan_users = scan;
      await stop_test_server(server);
    }
  });

  it('every live user appears over repeated calls, in user ID order', async () => {
    const { server } = await startServer({ 'user-snapshot-clone.maxSampleCount': 2 });
    try {
      const users: Session[] = [];
      for (let i = 0; i < 6; i += 1) users.push(await newUser(server, 'repeated'));
      const [first, , , second] = users;
      if (first === undefined || second === undefined) throw new Error('no users');
      await withdraw(first);
      await withdraw(second);
      const live = new Set(users.filter((u) => u !== first && u !== second).map((u) => String(u.user_id)));
      expect(live.size).toBe(4);
      const seen = new Set<string>();
      for (let i = 0; i < 40; i += 1) {
        const reply = await admin(server, 'sample_user_ids', { count: 2 });
        expect(reply.status).toBe(200);
        const ids = (reply.json as { user_ids: string[] }).user_ids;
        expect(ids.length).toBe(2);
        expect(new Set(ids).size).toBe(2);
        expect(BigInt(ids[0] ?? '0') < BigInt(ids[1] ?? '0')).toBe(true);
        for (const id of ids) {
          expect(live.has(id)).toBe(true);
          seen.add(id);
        }
      }
      expect(seen).toEqual(live);
    } finally {
      await stop_test_server(server);
    }
  });

  it('is bad_request for a count below 1 or above maxSampleCount', async () => {
    const { server } = await startServer({ 'user-snapshot-clone.maxSampleCount': 5 });
    try {
      expect((await admin(server, 'sample_user_ids', { count: 0 })).status).toBe(400);
      expect((await admin(server, 'sample_user_ids', { count: 6 })).status).toBe(400);
      expect((await admin(server, 'sample_user_ids', { count: 5 })).status).toBe(200);
    } finally {
      await stop_test_server(server);
    }
  });
});

describe('export in PROD', () => {
  const BOSS = 'CloneBossGameState';

  it('export_user_snapshot, export_game_state and sample_game_state return the stored rows with source_environment PROD, changing nothing', async () => {
    const { server, core } = await startServer();
    try {
      const source = await richUser(server, core, 'source');
      const local = await exportSnapshot(server, source.user_id);
      const column = GameContract.KINDS.find((k) => k.name === BOSS)?.column;
      if (column === undefined) throw new Error(`no game state kind ${BOSS}`);
      const writer = await newUser(server, 'writer');
      const write = await core.storage.run_user_transaction(writer.user_id, (ctx) => {
        for (const [key, hp] of [[1n, 100n], [2n, 200n]] as const) {
          const value = new GameContract.CloneBossGameState();
          value.key = key;
          value.hp = hp;
          core.storage.put_game_state(ctx, value, 0n);
        }
        return 'pass';
      });
      expect(write).toBe('COMMITTED');
      const prod = create_user_snapshot_clone({
        settings: {
          'user-snapshot-clone.maxSnapshotBytes': 1_000_000,
          'user-snapshot-clone.maxSampleCount': 100,
          'user-snapshot-clone.cloneRetentionMs': 86_400_000,
          'user-snapshot-clone.sweepIntervalMs': 60_000,
          'admin-api.maxBodyBytes': 65_536,
          appId: local.app_id,
          coreVersion: local.core_version,
        },
        modules: { validation: core.validation, storage: core.storage, session: core.session, 'server-time': core['server-time'], logging: core.logging },
        server: { env: 'PROD', data_version: local.data_version },
      });
      // Read operations run as admin-api runs them: inside run_read_only of the operation's transaction.
      const read = (operation: AdminOperation, input: Readonly<Record<string, unknown>>, transaction: RequestCtx | GameTx) =>
        core.storage.run_read_only(transaction, () => operation.handler(input, transaction, null, null));
      const before = dumpDb(core);

      const user: { output: AdminOutput | FailureReason | null } = { output: null };
      const status = await core.storage.run_user_transaction(source.user_id, (ctx) => {
        user.output = read(prod.export_user_snapshot, { user_id: source.user_id }, ctx);
        return 'pass';
      });
      expect(status).toBe('COMMITTED');
      const snapshot = user.output as unknown as UserSnapshot;
      expect(snapshot.source_environment).toBe('PROD');
      expect(snapshot.source_user_id).toBe(String(source.user_id));
      expect(snapshot.records).toEqual(recordsOf(await userRows(core, source.user_id)));
      expect(snapshot.records.length).toBeGreaterThan(0);

      const stored: SnapshotRecord[] = core.storage
        .read_db()
        .query('SELECT "key", value, contract_version FROM game_state WHERE kind = $1 ORDER BY "key"', [column])
        .map((r) => ({
          table: 'game_state',
          key: `${column}/${String(r['key'])}`,
          contract_version: Number(r['contract_version']),
          value: Buffer.from(r['value'] as Uint8Array).toString('base64'),
        }));
      expect(stored.length).toBe(2);
      const game = await core.storage.run_game_transaction((tx) => ({
        exported: read(prod.export_game_state, { kind: BOSS, keys: [1n, 2n] }, tx),
        sampled: read(prod.sample_game_state, { kind: BOSS, count: 10 }, tx),
      }));
      if (game === 'FAILED') throw new Error('game transaction failed');
      const exported = game.exported as unknown as GameStateSnapshot;
      const sampled = game.sampled as unknown as GameStateSnapshot;
      expect(exported.source_environment).toBe('PROD');
      expect(exported.records).toEqual(stored);
      expect(sampled.source_environment).toBe('PROD');
      expect([...sampled.records].sort((a, b) => a.key.localeCompare(b.key))).toEqual(stored);

      expect(dumpDb(core)).toEqual(before);
    } finally {
      await stop_test_server(server);
    }
  });
});
