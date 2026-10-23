import * as GameContract from '../../../generated/contract/game_contract.ts';
import { advance_time, read_logs, read_user_state, stop_test_server, wait_background } from '../../testing/dev/index.ts';
import type { ColumnInput, Storage } from '../../storage/index.ts';
import { create_user_snapshot_clone } from '../index.ts';
import { records_sha256, type SnapshotRecord } from '../snapshot.ts';
import {
  accountName,
  admin,
  balance,
  changeable,
  claimMail,
  devLogin,
  dumpDb,
  encodeJson,
  exportSnapshot,
  grant,
  imported,
  importSnapshot,
  jsonParses,
  loginAgain,
  mail,
  newUser,
  recordsOf,
  resync,
  richUser,
  startServer,
  testItems,
  userRecord,
  userRows,
  withFields,
  withRecords,
  withdraw,
  without,
  type Core,
  type Server,
} from './helpers.ts';

/**
 * The note table the next `storage` module registers, as a core module does from `create_<module>`: `extra` adds the
 * `?` column `extra`, `null` registers none. Content `register(core)` has no `register_table`.
 */
const note_table = globalThis as { user_snapshot_clone_note_table?: { extra: boolean } | null };

vi.mock('../../storage/index.ts', async (import_original) => {
  const original = await import_original<typeof import('../../storage/index.ts')>();
  return {
    ...original,
    create_storage: (input: Parameters<typeof original.create_storage>[0]) => {
      const storage = original.create_storage(input);
      const table = note_table.user_snapshot_clone_note_table ?? null;
      if (table !== null) {
        const columns: ColumnInput[] = [
          { name: 'user_id', type: 'int64' },
          { name: 'note_id', type: 'int64' },
          { name: 'text', type: 'string' },
        ];
        if (table.extra) columns.push({ name: 'extra', type: 'int64?' });
        storage.register_table('user_snapshot_clone_test_note', 'user', columns, ['user_id', 'note_id'], null, true);
      }
      return storage;
    },
  };
});

/** Proto bytes with an unknown length-delimited field 1000 of `size` bytes appended: the message reads the same. */
function withUnknownField(value: string, size: number): string {
  const varint = (n: number): number[] => {
    const out: number[] = [];
    let v = n;
    while (v >= 0x80) {
      out.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 0x80);
    }
    out.push(v);
    return out;
  };
  const field = Buffer.concat([Buffer.from([...varint((1000 << 3) | 2), ...varint(size)]), Buffer.alloc(size, 0x5a)]);
  return Buffer.concat([Buffer.from(value, 'base64'), field]).toString('base64');
}

/** Imports `snapshot` into `target` and expects a failure status with every table row unchanged. */
async function expectRefused(server: Server, core: Core, target: bigint, snapshot: unknown, status: number): Promise<void> {
  const before = dumpDb(core);
  const reply = await importSnapshot(server, target, snapshot);
  expect(reply.status).toBe(status);
  expect(dumpDb(core)).toEqual(before);
}

describe('import_user_snapshot', () => {
  let server: Server;
  let core: Core;

  beforeAll(async () => {
    ({ server, core } = await startServer());
  });

  afterAll(async () => {
    await stop_test_server(server);
  });

  it('makes the target included rows the snapshot and leaves the excluded table rows', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    const target_before = await exportSnapshot(server, target.user_id);
    const before = dumpDb(core);
    const output = imported(await importSnapshot(server, target.user_id, snapshot));
    expect(output.replaced_records).toBe(snapshot.records.length);
    expect(recordsOf(await userRows(core, target.user_id))).toEqual(snapshot.records);
    const tables = changeable(snapshot, target_before);
    expect(without(dumpDb(core), tables)).toEqual(without(before, tables));
    // The source is unchanged.
    expect(recordsOf(await userRows(core, source.user_id))).toEqual(snapshot.records);
  });

  it('stores a lower contract version record with the version it got', async () => {
    const source = await richUser(server, core, 'source');
    const target = await newUser(server, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    const records = snapshot.records.map((r) => (r.table === 'user_state' ? { ...r, contract_version: 0 } : r));
    imported(await importSnapshot(server, target.user_id, withRecords(snapshot, records)));
    const rows = core.storage.read_db().query('SELECT contract_version FROM user_state WHERE user_id = $1', [target.user_id]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(BigInt(String(row['contract_version']))).toBe(0n);
  });

  it('pays a mail the target already claimed under the same mail ID, without ALREADY_APPLIED', async () => {
    const items = testItems();
    const source = await newUser(server, 'source');
    const target = await newUser(server, 'target');
    const target_mail = await mail(server, target.user_id, items.template, items.plain, 3n);
    expect((await claimMail(target, target_mail)).envelope.error).toBeNull();
    const source_mail = await mail(server, source.user_id, items.template, items.plain, 5n);
    expect(source_mail).toBe(target_mail);
    imported(await importSnapshot(server, target.user_id, await exportSnapshot(server, source.user_id)));
    const again = await loginAgain(server, target.user_id);
    const before = await balance(core, target.user_id, items.plain);
    const claimed = await claimMail(again, source_mail);
    expect(claimed.envelope.error).toBeNull();
    expect(claimed.response?.items.map((i) => [i.item_id, i.amount])).toEqual([[items.plain, 5n]]);
    expect(await balance(core, target.user_id, items.plain)).toBe(before + 5n);
  });

  it('ends the target session, and a new login gets the snapshot UserState', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    imported(await importSnapshot(server, target.user_id, await exportSnapshot(server, source.user_id)));
    expect(await resync(target)).not.toBeNull();
    const again = await loginAgain(server, target.user_id);
    expect(await resync(again)).toBeNull();
    const strip = (items: readonly { kind: string; item_id: bigint; value: unknown }[]) => items.map((i) => ({ kind: i.kind, item_id: i.item_id, value: i.value }));
    // Login writes what it derives (for example `ConsentUserState`), so the source logs in again the same way.
    expect(await resync(await loginAgain(server, source.user_id))).toBeNull();
    expect(strip(await read_user_state(server, target.user_id))).toEqual(strip(await read_user_state(server, source.user_id)));
  });

  it('succeeds on another data_version and says data_version_matches false with the server data version', async () => {
    const source = await richUser(server, core, 'source');
    const target = await newUser(server, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    const same = imported(await importSnapshot(server, target.user_id, snapshot));
    expect(same.data_version_matches).toBe(true);
    expect(same.data_version).toBe(snapshot.data_version);
    const other = imported(await importSnapshot(server, target.user_id, withFields(snapshot, { data_version: `${snapshot.data_version}-other` })));
    expect(other.data_version_matches).toBe(false);
    expect(other.data_version).toBe(snapshot.data_version);
  });

  it('refuses a wrong sha256, another app_id, a higher contract version and a higher core version, changing nothing', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    await expectRefused(server, core, target.user_id, withFields(snapshot, { sha256: 'f'.repeat(64) }), 400);
    await expectRefused(server, core, target.user_id, withFields(snapshot, { app_id: `${snapshot.app_id}.other` }), 409);
    await expectRefused(server, core, target.user_id, withFields(snapshot, { contract_version: GameContract.CONTRACT_VERSION + 1 }), 409);
    const records = snapshot.records.map((r, i) => (i === 0 ? { ...r, contract_version: GameContract.CONTRACT_VERSION + 1 } : r));
    await expectRefused(server, core, target.user_id, withRecords(snapshot, records), 409);
    const major = Number(snapshot.core_version.split('.')[0]);
    await expectRefused(server, core, target.user_id, withFields(snapshot, { core_version: `${String(major + 1)}.0.0` }), 409);
    // The same core version is taken.
    imported(await importSnapshot(server, target.user_id, snapshot));
  });

  it('is bad_request for snapshot fields and record fields of the wrong JSON type, changing nothing', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    await expectRefused(server, core, target.user_id, withFields(snapshot, { format: '1' }), 400);
    await expectRefused(server, core, target.user_id, withFields(snapshot, { format: 2 }), 400);
    await expectRefused(server, core, target.user_id, withFields(snapshot, { contract_version: String(snapshot.contract_version) }), 400);
    await expectRefused(server, core, target.user_id, withFields(snapshot, { exported_at: Number(snapshot.exported_at) }), 400);
    const records = snapshot.records.map((r, i) => (i === 0 ? { ...r, contract_version: String(r.contract_version) } : r));
    await expectRefused(server, core, target.user_id, { ...snapshot, records, sha256: records_sha256(records as unknown as SnapshotRecord[]) }, 400);
    await expectRefused(server, core, target.user_id, encodeJson('[]'), 400);
  });

  it('is bad_request for a core_version that validation.parse_version cannot read, changing nothing', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    const [major, minor, patch] = snapshot.core_version.split('.');
    // A leading zero names a version no higher than the server's, so only the version form refuses it.
    for (const core_version of [`0${String(major)}.${String(minor)}.${String(patch)}`, `${String(major)}.0${String(minor)}.${String(patch)}`, `${String(major)}.${String(minor)}.0${String(patch)}`]) {
      await expectRefused(server, core, target.user_id, withFields(snapshot, { core_version }), 400);
    }
  });

  it('is bad_request for a record of a table it does not hold', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    for (const table of ['session_current', 'game_state', 'no_such_table']) {
      const records = [...snapshot.records, { table, key: '["x"]', contract_version: 0, value: '' }];
      await expectRefused(server, core, target.user_id, withRecords(snapshot, records), 400);
    }
    const bad_key = snapshot.records.map((r, i) => (i === 0 ? { ...r, key: 'not a key' } : r));
    await expectRefused(server, core, target.user_id, withRecords(snapshot, bad_key), 400);
  });

  it('is bad_request for a user_state and a server_state key above int64, changing nothing', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    const index = snapshot.records.findIndex((r) => r.table === 'user_state');
    if (index < 0) throw new Error('no user_state record');
    // The test user has no server_state row, so the server_state record is the user_state record in that table.
    for (const table of ['user_state', 'server_state']) {
      const records = snapshot.records.map((r, i) => (i === index ? { ...r, table, key: r.key.replace(/\/[0-9]+$/, '/9223372036854775808') } : r));
      await expectRefused(server, core, target.user_id, withRecords(snapshot, records), 400);
    }
    // int64 max itself is a key storage takes.
    const records = snapshot.records.map((r, i) => (i === index ? { ...r, key: r.key.replace(/\/[0-9]+$/, '/9223372036854775807') } : r));
    imported(await importSnapshot(server, target.user_id, withRecords(snapshot, records)));
  });

  it('is bad_request for two records with the same table and key, changing nothing', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    const first = snapshot.records.find((r) => r.table === 'user_state');
    if (first === undefined) throw new Error('no user_state record');
    await expectRefused(server, core, target.user_id, withRecords(snapshot, [...snapshot.records, first]), 400);
  });

  it('leaves the target rows when storing fails', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    // The rows are written, and then the storage call fails: the user transaction must not commit them.
    const storage = core.storage as { replace_user_rows: Storage['replace_user_rows'] };
    const original = storage.replace_user_rows;
    storage.replace_user_rows = (ctx, rows) => {
      original(ctx, rows);
      throw new Error('storing failed');
    };
    try {
      await expectRefused(server, core, target.user_id, snapshot, 500);
    } finally {
      storage.replace_user_rows = original;
    }
  });

  it('takes a record value above 4.5M base64 characters, and a long value that is not base64 is bad_request', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    const index = snapshot.records.findIndex((r) => r.table === 'user_state');
    const first = snapshot.records[index];
    if (first === undefined) throw new Error('no user_state record');
    const long = { ...first, value: withUnknownField(first.value, 3_400_000) };
    expect(long.value.length).toBeGreaterThan(4_500_000);
    const records = snapshot.records.map((r, i) => (i === index ? long : r));
    await expectRefused(server, core, target.user_id, withRecords(snapshot, records.map((r, i) => (i === index ? { ...r, value: `${r.value.slice(0, -1)}!` } : r))), 400);
    const output = imported(await importSnapshot(server, target.user_id, withRecords(snapshot, records)));
    expect(output.replaced_records).toBe(records.length);
    expect(recordsOf(await userRows(core, target.user_id))).toEqual(records);
    expect((await exportSnapshot(server, target.user_id)).records).toEqual(records);
  });

  it('audit args hold source_environment, source_user_id, sha256 and target_user_id, not the snapshot', async () => {
    const source = await richUser(server, core, 'source');
    const target = await newUser(server, 'target');
    const snapshot = await exportSnapshot(server, source.user_id);
    imported(await importSnapshot(server, target.user_id, snapshot));
    const lines = read_logs(server, 'audit').filter((l) => l['request'] === 'import_user_snapshot' && l['status'] === 200);
    const args = lines[lines.length - 1]?.['args'] as Record<string, unknown> | undefined;
    if (args === undefined) throw new Error('no import_user_snapshot audit line');
    expect(Object.keys(args).sort()).toEqual(['sha256', 'source_environment', 'source_user_id', 'target_user_id']);
    expect(args['source_environment']).toBe(snapshot.source_environment);
    expect(String(args['source_user_id'])).toBe(snapshot.source_user_id);
    expect(args['sha256']).toBe(snapshot.sha256);
    expect(String(args['target_user_id'])).toBe(String(target.user_id));
  });

  it('parses a body once for audit_args and prepare', async () => {
    const source = await richUser(server, core, 'source');
    const target = await newUser(server, 'target');
    const body = encodeJson(await exportSnapshot(server, source.user_id));
    const text = new TextDecoder().decode(body);
    const operation = core['user-snapshot-clone'].import_user_snapshot;
    const input = { target_user_id: target.user_id };
    const parses = await jsonParses(text, async () => {
      const args = operation.audit_args?.(input, body);
      const prepared = await operation.prepare?.(input, body);
      expect(args?.['sha256']).toBe((prepared as { sha256: string }).sha256);
    });
    expect(parses).toBe(1);
  });

  it('is not_found for a missing target and a withdrawn target', async () => {
    const source = await richUser(server, core, 'source');
    const snapshot = await exportSnapshot(server, source.user_id);
    expect((await importSnapshot(server, 999_999_999n, snapshot)).status).toBe(404);
    const target = await newUser(server, 'target');
    await withdraw(target);
    expect((await importSnapshot(server, target.user_id, snapshot)).status).toBe(404);
  });
});

describe('import_user_snapshot user_created_at', () => {
  it('carries user_created_at: the user record, AuthResult and recovery balance follow it, and a clone wipe keeps it', async () => {
    const { server, core } = await startServer();
    try {
      const items = testItems();
      const source = await newUser(server, 'source');
      advance_time(server, 600_000n);
      await wait_background(server);
      const target = await newUser(server, 'target');
      await grant(server, target.user_id, items.recovery, 1n);
      const created_at = userRecord(core, source.user_id).created_at;
      expect(userRecord(core, target.user_id).created_at).not.toBe(created_at);
      const snapshot = await exportSnapshot(server, source.user_id);
      expect(snapshot.user_created_at).toBe(String(created_at));
      imported(await importSnapshot(server, target.user_id, snapshot));
      expect(userRecord(core, target.user_id).created_at).toBe(created_at);
      const auth = await devLogin(source, accountName(target.user_id));
      expect(auth.user_id).toBe(target.user_id);
      expect(auth.user_created_at).toBe(created_at);
      advance_time(server, 300_000n);
      await wait_background(server);
      expect(await balance(core, target.user_id, items.recovery)).toBe(await balance(core, source.user_id, items.recovery));
      expect((await admin(server, 'wipe_clone', { target_user_id: String(target.user_id) })).status).toBe(200);
      expect(userRecord(core, target.user_id).created_at).toBe(created_at);
    } finally {
      await stop_test_server(server);
    }
  });
});

describe('import_user_snapshot body limit', () => {
  it('takes a body above admin-api.maxBodyBytes up to maxSnapshotBytes, and a larger body is 400 bad_request', async () => {
    const { server, core } = await startServer({ 'admin-api.maxBodyBytes': 1024, 'user-snapshot-clone.maxSnapshotBytes': 32_768 });
    try {
      const source = await richUser(server, core, 'source');
      const target = await newUser(server, 'target');
      const text = JSON.stringify(await exportSnapshot(server, source.user_id));
      expect(text.length + 1024).toBeLessThan(32_768);
      // JSON whitespace pads the body without changing the snapshot.
      const padded = (size: number) => encodeJson(text + ' '.repeat(size - text.length));
      imported(await importSnapshot(server, target.user_id, padded(text.length + 1024)));
      imported(await importSnapshot(server, target.user_id, padded(32_768)));
      await expectRefused(server, core, target.user_id, padded(32_769), 400);
      expect((await importSnapshot(server, target.user_id, padded(32_769))).json).toEqual({ error: 'bad_request' });
    } finally {
      await stop_test_server(server);
    }
  });
});

describe('import_user_snapshot module table columns', () => {
  const NOTE = 'user_snapshot_clone_test_note';

  /** A test server whose `storage` registers the note table, with or without the `?` column `extra`. */
  async function with_note(extra: boolean): Promise<{ server: Server; core: Core }> {
    note_table.user_snapshot_clone_note_table = { extra };
    try {
      return await startServer();
    } finally {
      note_table.user_snapshot_clone_note_table = null;
    }
  }

  it('stores null in a ? column the source server did not register, and refuses records that break the columns', async () => {
    const a = await with_note(false);
    const b = await with_note(true);
    try {
      const source = await newUser(a.server, 'source');
      const write = await a.core.storage.run_user_transaction(source.user_id, (ctx) => {
        a.core.storage.db(ctx).query(`INSERT INTO ${NOTE} (user_id, note_id, text) VALUES ($1, $2, $3)`, [source.user_id, 1n, 'hello']);
        return 'pass';
      });
      expect(write).toBe('COMMITTED');
      const snapshot = await exportSnapshot(a.server, source.user_id);
      expect(snapshot.records.some((r) => r.table === NOTE)).toBe(true);
      const target = await newUser(b.server, 'target');
      imported(await importSnapshot(b.server, target.user_id, snapshot));
      const rows = b.core.storage.read_db().query(`SELECT note_id, text, extra FROM ${NOTE} WHERE user_id = $1`, [target.user_id]);
      expect(rows.map((r) => [BigInt(String(r['note_id'])), r['text'], r['extra']])).toEqual([[1n, 'hello', null]]);

      const others = snapshot.records.filter((r) => r.table !== NOTE);
      const value = (json: unknown) => Buffer.from(JSON.stringify(json), 'utf8').toString('base64');
      for (const bad of [{ note_id: '1', text: 'hello', unknown_column: 1 }, { note_id: '1' }, { note_id: '1', text: 5 }]) {
        const records = [...others, { table: NOTE, key: '["1"]', contract_version: 0, value: value(bad) }];
        await expectRefused(b.server, b.core, target.user_id, withRecords(snapshot, records), 400);
      }
    } finally {
      await stop_test_server(a.server);
      await stop_test_server(b.server);
    }
  });
});

describe('import in PROD', () => {
  it('is conflict for import_user_snapshot and import_game_state, changing nothing', async () => {
    const { server, core } = await startServer();
    try {
      const source = await richUser(server, core, 'source');
      const target = await richUser(server, core, 'target');
      const snapshot = await exportSnapshot(server, source.user_id);
      const prod = create_user_snapshot_clone({
        settings: {
          'user-snapshot-clone.maxSnapshotBytes': 1_000_000,
          'user-snapshot-clone.maxSampleCount': 100,
          'user-snapshot-clone.cloneRetentionMs': 86_400_000,
          'user-snapshot-clone.sweepIntervalMs': 60_000,
          'admin-api.maxBodyBytes': 65_536,
          appId: snapshot.app_id,
          coreVersion: snapshot.core_version,
        },
        modules: { validation: core.validation, storage: core.storage, session: core.session, 'server-time': core['server-time'], logging: core.logging },
        server: { env: 'PROD', data_version: snapshot.data_version },
      });
      const before = dumpDb(core);
      expect(await prod.import_user_snapshot.prepare?.({ target_user_id: target.user_id }, encodeJson(snapshot))).toBe('conflict');
      const game = { ...snapshot, records: [], sha256: records_sha256([]) } as Record<string, unknown>;
      delete game['source_user_id'];
      delete game['user_created_at'];
      expect(await prod.import_game_state.prepare?.({}, encodeJson(game))).toBe('conflict');
      expect(dumpDb(core)).toEqual(before);
    } finally {
      await stop_test_server(server);
    }
  });
});
