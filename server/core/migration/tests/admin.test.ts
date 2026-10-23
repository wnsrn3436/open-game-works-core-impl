/**
 * The admin operations and `migrate_snapshot` on a test server: the generated contract of the core test data
 * (contract version 1, no converter), `admin-api` in front of the admin operations, `call_dev` for the DEV operation.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import { CLONE_AVAILABLE, snapshot } from './helpers.ts';

const servers: testing.TestServer[] = [];
/** `storage.userLockWaitMs` of the lock wait tests: the wait of a held lock ends soon. */
const LOCK_WAIT_MS = 300;

afterEach(async () => {
  for (const server of servers.splice(0)) if (!server.stopped) await testing.stop_test_server(server);
});

async function start(db?: 'sqlite' | 'postgresql', settings?: Readonly<Record<string, unknown>>): Promise<testing.TestServer> {
  const server = await testing.start_test_server(undefined, db, undefined, undefined, undefined, settings);
  servers.push(server);
  return server;
}

interface Reply {
  readonly status: number;
  readonly json: Record<string, unknown>;
}

async function admin(server: testing.TestServer, operation: 'start_migration_batch' | 'get_migration_batch' | 'stop_migration_batch'): Promise<Reply> {
  const reply = await testing.send_admin(server, operation, {});
  return { status: reply.status, json: typeof reply.json === 'object' && reply.json !== null ? (reply.json as Record<string, unknown>) : {} };
}

function audits(server: testing.TestServer, operation: string): Record<string, unknown>[] {
  return testing.read_logs(server, 'audit').filter((line) => line['request'] === operation);
}

describe('admin operations', () => {
  it('start_migration_batch is conflict while a batch is RUNNING, and of two concurrent calls only one makes a batch', async () => {
    const server = await start();
    const both = await Promise.all([admin(server, 'start_migration_batch'), admin(server, 'start_migration_batch')]);
    expect(both.filter((r) => r.status === 200 && typeof r.json['batch_id'] === 'string')).toHaveLength(1);
    expect(both.filter((r) => r.json['error'] === 'conflict')).toHaveLength(1);
    expect((await admin(server, 'start_migration_batch')).json['error']).toBe('conflict');
    expect(audits(server, 'start_migration_batch')).toHaveLength(3);
  });

  it('get_migration_batch returns the batch with the latest started_at, and stop_migration_batch without a RUNNING batch is not_found', async () => {
    const server = await start();
    expect((await admin(server, 'get_migration_batch')).json['error']).toBe('not_found');
    expect((await admin(server, 'stop_migration_batch')).json['error']).toBe('not_found');
    const first = (await admin(server, 'start_migration_batch')).json['batch_id'];
    const stopped = await admin(server, 'stop_migration_batch');
    expect(stopped.status).toBe(200);
    expect(stopped.json).toEqual({});
    expect((await admin(server, 'stop_migration_batch')).json['error']).toBe('not_found');
    expect((await admin(server, 'get_migration_batch')).json).toMatchObject({ batch_id: first, status: 'STOPPED' });
    testing.advance_time(server, 1000n);
    const second = (await admin(server, 'start_migration_batch')).json['batch_id'];
    expect(second).not.toBe(first);
    const latest = await admin(server, 'get_migration_batch');
    expect(latest.json).toMatchObject({ batch_id: second, status: 'RUNNING' });
    expect(BigInt(String(latest.json['started_at']))).toBeGreaterThan(0n);
  });

  it('start_migration_batch whose migration_batch key "" lock another transaction holds past storage.userLockWaitMs is internal with an audit line and makes no batch (PostgreSQL)', async () => {
    const server = await start('postgresql', { 'storage.userLockWaitMs': LOCK_WAIT_MS });
    // The holder's connection is on the test's thread, which the lock wait of start_migration_batch blocks: the wait
    // ends at storage.userLockWaitMs, with lock_game_row FAILED.
    const release = await testing.hold_game_row_lock(server, 'migration_batch', ['']);
    let started: Reply;
    try {
      started = await admin(server, 'start_migration_batch');
    } finally {
      await release();
    }
    expect(started).toEqual({ status: 500, json: { error: 'internal' } });
    expect(audits(server, 'start_migration_batch')).toHaveLength(1);
    expect((await admin(server, 'get_migration_batch')).json['error']).toBe('not_found');
    expect((await admin(server, 'start_migration_batch')).status).toBe(200);
  });
});

describe.skipIf(!CLONE_AVAILABLE)('migrate_snapshot through call_dev', () => {
  it('returns a result for every record and does not change the DB', async () => {
    const server = await start();
    const session = await testing.login(server, 'migration_snapshot');
    const before = [await testing.read_user_state(server, session.user_id), await testing.read_server_state(server, session.user_id)];
    const nickname = CoreContract.NicknameUserState.decode(new Uint8Array()) ?? new CoreContract.NicknameUserState();
    const module_row = { table: 'mailbox_mail', key: '["5"]', contract_version: 0n, value: new TextEncoder().encode('{"mail_id":"5"}') };
    const records = [
      { table: 'user_state', key: 'nickname_user_state/0', contract_version: BigInt(GameContract.CONTRACT_VERSION), value: nickname.encode() },
      module_row,
    ];
    const output = await testing.call_dev(server, 'migration', 'migrate_snapshot', [snapshot(records, { source_user_id: String(session.user_id), user_created_at: '1700000000000' })]);
    expect(output).toEqual([
      { table: 'mailbox_mail', key: '["5"]', from_version: 0, result: 'UNCHANGED', error: null },
      { table: 'user_state', key: 'nickname_user_state/0', from_version: GameContract.CONTRACT_VERSION, result: 'UNCHANGED', error: null },
    ]);
    expect([await testing.read_user_state(server, session.user_id), await testing.read_server_state(server, session.user_id)]).toEqual(before);
    expect(await testing.call_dev(server, 'migration', 'migrate_snapshot', [{ format: 1 }])).toBe('bad_request');
  });
});
