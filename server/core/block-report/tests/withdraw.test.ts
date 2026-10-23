import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { login } from '../../testing/dev/index.ts';
import { BLOCK_TABLE, REPORT_TABLE } from '../index.ts';
import { admin, block_user, id_value, in_request, list_reports, report_user, SPAM, start, stop_all, withdraw } from './kit.ts';

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
});
