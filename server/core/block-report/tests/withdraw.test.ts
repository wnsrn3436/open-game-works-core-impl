import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { default_db_kind, hold_game_row_lock, login, start_peer_process, stop_peer_processes, until_blocked_by, type PeerProcess, type TestSession } from '../../testing/dev/index.ts';
import { BLOCK_TABLE, REPORT_TABLE, SEQUENCE_TABLE } from '../index.ts';
import { admin, block_user, id_value, in_request, list_reports, report_rows, report_user, rpc, SPAM, start, stop_all, withdraw, type Instance } from './kit.ts';
import { EVIDENCE, REMOVED_GATE, REPORTED_GATE } from './peer.ts';

afterEach(async () => {
  await stop_all();
});

describe('Withdraw', () => {
  it('deletes the block rows of the user, keeps the reports the user wrote, and export_personal_data has them', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect((await report_user(alice, bob.user_id, { ref: 'r', comment: 'spam links' })).code).toBeNull();
    const [report] = await list_reports(instance);

    expect((await withdraw(alice)).code).toBeNull();
    expect(instance.storage.read_db().query(`SELECT blocked_id FROM ${BLOCK_TABLE} WHERE user_id = $1`, [alice.user_id])).toEqual([]);
    expect(await list_reports(instance)).toEqual([report]);

    const exported = await admin(instance, 'export_personal_data', { user_id: String(alice.user_id) });
    expect(exported.status).toBe(200);
    const tables = (exported.json as { tables: Record<string, Record<string, unknown>[]> }).tables;
    expect(tables[REPORT_TABLE]).toEqual([
      expect.objectContaining({ report_id: report?.report_id, reporter_id: String(alice.user_id), target_id: String(bob.user_id), comment: 'spam links', status: 'Open' }),
    ]);
  });

  it('does not put the reports of which the user is only the target into export_personal_data', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await report_user(alice, bob.user_id)).code).toBeNull();
    const exported = await admin(instance, 'export_personal_data', { user_id: String(bob.user_id) });
    expect(exported.status).toBe(200);
    const tables = (exported.json as { tables: Record<string, unknown[]> }).tables;
    expect(tables[REPORT_TABLE] ?? []).toEqual([]);
  });

  it('empties the evidence of the reports of which the user is the target and keeps the report rows and other columns', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const carol = await login(instance.server, 'carol');
    const chat = CoreContract.ReportContext.REPORT_CONTEXT_CHAT;
    const ref = `CHAT_CHANNEL_KIND_DIRECT:${String(alice.user_id)}:${String(bob.user_id)}:7`;
    const results = await in_request(instance, alice, (ctx) => [
      instance.block.add_report(ctx, bob.user_id, id_value(SPAM), chat, ref, '', 'message by bob'),
      instance.block.add_report(ctx, carol.user_id, id_value(SPAM), chat, 'c', '', 'message by carol'),
    ]);
    expect(results).toEqual(['OK', 'OK']);
    const before = await list_reports(instance);

    expect((await withdraw(bob)).code).toBeNull();
    const after = await list_reports(instance);
    expect(after).toEqual(before.map((report) => (report.target_id === String(bob.user_id) ? { ...report, evidence: '' } : report)));
    expect(after.find((report) => report.target_id === String(carol.user_id))?.evidence).toBe('message by carol');
  });

  it('add_report with evidence of a target that already withdrew is OK and writes the report row with an empty evidence', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await withdraw(bob)).code).toBeNull();
    const chat = CoreContract.ReportContext.REPORT_CONTEXT_CHAT;
    expect(await in_request(instance, alice, (ctx) => instance.block.add_report(ctx, bob.user_id, id_value(SPAM), chat, 'r', '', 'message by bob'))).toBe('OK');
    expect(report_rows(instance)).toEqual([expect.objectContaining({ target_id: bob.user_id, evidence: '' })]);
  });

  it('remove_user is FAILED on a lock wait over the limit of the block_report_sequence row: Withdraw is INTERNAL and rolls back, and the next Withdraw goes through', async () => {
    const instance = await start({ settings: { 'storage.userLockWaitMs': 200 } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const chat = CoreContract.ReportContext.REPORT_CONTEXT_CHAT;
    expect(await in_request(instance, alice, (ctx) => instance.block.add_report(ctx, bob.user_id, id_value(SPAM), chat, 'r', '', 'message by bob'))).toBe('OK');
    const release = await hold_game_row_lock(instance.server, SEQUENCE_TABLE, [0n]);
    try {
      expect((await withdraw(bob)).code).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    } finally {
      await release();
    }
    expect(report_rows(instance)).toEqual([expect.objectContaining({ evidence: 'message by bob' })]);
    expect(instance.storage.read_db().query('SELECT withdrawn_at FROM "user" WHERE user_id = $1', [bob.user_id])).toEqual([{ withdrawn_at: null }]);
    expect((await withdraw(bob)).code).toBeNull();
    expect(report_rows(instance)).toEqual([expect.objectContaining({ evidence: '' })]);
  });
});

describe.runIf(default_db_kind() === 'postgresql')('add_report and Withdraw of its target on two server instances (PostgreSQL)', () => {
  const PEER = { module: new URL('./peer.ts', import.meta.url), name: 'block_report_peer' };
  const T = 60_000;

  afterEach(stop_peer_processes);

  /** A reporter on one peer process with a block row that names the target to report, and the target on another. */
  async function on_peers(): Promise<{ instance: Instance; reporting: PeerProcess; withdrawing: PeerProcess; alice: TestSession; bob: TestSession }> {
    const instance = await start({ settings: { 'storage.userLockWaitMs': 20_000 } });
    const reporting = await start_peer_process(instance.server, PEER);
    const withdrawing = await start_peer_process(instance.server, PEER);
    const alice = await login(reporting.remote, 'alice');
    const bob = await login(withdrawing.remote, 'bob');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    return { instance, reporting, withdrawing, alice, bob };
  }

  function report_on_peer(alice: TestSession): Promise<{ code: number | null }> {
    return rpc(alice, 'RunCoreTest', new GameContract.RunCoreTestRequest());
  }

  it('an add_report that holds the block_report_sequence lock makes remove_user of its target wait, and after both commit the evidence is empty', async () => {
    const { instance, reporting, withdrawing, alice, bob } = await on_peers();
    const reported = report_on_peer(alice);
    // add_report wrote its row with the evidence, the target being active, and waits in its transaction with the lock.
    const pid = Number(await reporting.reached(REPORTED_GATE));
    const withdrawn = withdraw(bob);
    await until_blocked_by(instance.server, pid);
    reporting.open(REPORTED_GATE);
    expect((await reported).code).toBeNull();
    await withdrawing.reached(REMOVED_GATE);
    withdrawing.open(REMOVED_GATE);
    expect((await withdrawn).code).toBeNull();
    expect(report_rows(instance)).toEqual([expect.objectContaining({ target_id: bob.user_id, evidence: '' })]);
  }, T);

  it('an add_report that waits for the lock of remove_user reads its target as withdrawn once the Withdraw commits, and writes an empty evidence', async () => {
    const { instance, reporting, withdrawing, alice, bob } = await on_peers();
    const withdrawn = withdraw(bob);
    // remove_user holds the lock and waits in the transaction whose commit writes the withdrawal.
    const pid = Number(await withdrawing.reached(REMOVED_GATE));
    const reported = report_on_peer(alice);
    await until_blocked_by(instance.server, pid);
    expect(report_rows(instance)).toEqual([]);
    withdrawing.open(REMOVED_GATE);
    expect((await withdrawn).code).toBeNull();
    reporting.open(REPORTED_GATE);
    expect((await reported).code).toBeNull();
    expect(report_rows(instance)).toEqual([expect.objectContaining({ target_id: bob.user_id, evidence: '' })]);
  }, T);

  it('without a withdrawal the peer add_report keeps its evidence', async () => {
    const { instance, reporting, alice, bob } = await on_peers();
    const reported = report_on_peer(alice);
    await reporting.reached(REPORTED_GATE);
    reporting.open(REPORTED_GATE);
    expect((await reported).code).toBeNull();
    expect(report_rows(instance)).toEqual([expect.objectContaining({ target_id: bob.user_id, evidence: EVIDENCE })]);
  }, T);
});
