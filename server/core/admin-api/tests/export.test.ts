// export_personal_data and list_payments.
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { admin, audits, has_module, login, MISSING_USER, send, start, stop, withdraw, type Server, type Session } from './helpers.ts';

/** Reports one client error whose message is `message`: a row of `logging_client_error`, scope `user`. */
async function report_error(session: Session, message: string): Promise<void> {
  const entry = new CoreContract.ClientErrorEntry();
  entry.time_at = 1n;
  entry.level = 'error';
  entry.tag = 'test';
  entry.message = message;
  const request = new CoreContract.ReportClientErrorsRequest();
  request.errors = [entry];
  expect((await send(session, 'core/ReportClientErrors', request)).code).toBe(0);
}

/** Bans a user: a row of `admin_api_ban`, scope `game`. */
async function ban(server: Server, user_id: string, reason: string): Promise<void> {
  expect((await admin(server, 'ban_user', { user_id, until_at: '0', reason })).status).toBe(200);
}

type Tables = Record<string, Record<string, unknown>[]>;

describe('export_personal_data', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('puts only the user\'s rows of user and game scope tables registered with a personal data user column in tables, and answers an attachment', async () => {
    server = await start();
    const a = await login(server, 'export_a');
    const b = await login(server, 'export_b');
    await report_error(a.session, 'error-of-a-31');
    await report_error(b.session, 'error-of-b-47');
    await ban(server, a.user_id, 'reason-of-a');
    await ban(server, b.user_id, 'reason-of-b');
    const reply = await admin(server, 'export_personal_data', { user_id: a.user_id });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('application/json');
    expect(reply.headers['content-disposition']).toBe(`attachment; filename="personal-data-${a.user_id}.json"`);
    expect(Object.keys(reply.json).sort()).toEqual(['created_at', 'exported_at', 'tables', 'user_id', 'user_state']);
    expect(reply.json.user_id).toBe(a.user_id);
    const tables = reply.json.tables as Tables;
    // `user` scope and `game` scope tables with the column; only rows of the user.
    expect(tables.logging_client_error?.map((row) => [row.user_id, row.message])).toEqual([[a.user_id, 'error-of-a-31']]);
    expect(tables.admin_api_ban?.map((row) => [row.user_id, row.reason])).toEqual([[a.user_id, 'reason-of-a']]);
    for (const rows of Object.values(tables)) for (const row of rows) expect(row.user_id).toBe(a.user_id);
    expect(reply.text).not.toContain('error-of-b-47');
    expect(reply.text).not.toContain('reason-of-b');
    // Tables registered without the column are not in the file.
    expect(Object.keys(tables)).not.toContain('admin_api_switch');
    expect(Object.keys(tables)).not.toContain('admin_api_operation');
    expect(Object.keys(tables)).not.toContain('item_ledger_history');
  });

  it('answers 404 for a user that does not exist and 413 for a file over admin-api.maxExportBytes', async () => {
    server = await start({ settings: { 'admin-api.maxExportBytes': 32 } });
    const { user_id } = await login(server, 'export_big');
    expect((await admin(server, 'export_personal_data', { user_id: MISSING_USER })).status).toBe(404);
    const reply = await admin(server, 'export_personal_data', { user_id });
    expect(reply.status).toBe(413);
    expect(reply.json).toEqual({ error: 'too_large' });
  });

  it('keeps only user_id in the audit log args, not the file', async () => {
    server = await start();
    const { session, user_id } = await login(server, 'export_audit');
    await report_error(session, 'marker-audit-91');
    const reply = await admin(server, 'export_personal_data', { user_id });
    expect(reply.status).toBe(200);
    expect(reply.text).toContain('marker-audit-91');
    const line = audits(server, 'export_personal_data')[0];
    expect(line?.args).toEqual({ user_id });
    expect(Object.hasOwn(line ?? {}, 'body_sha256')).toBe(false);
    expect(JSON.stringify(audits(server))).not.toContain('marker-audit-91');
  });

  it('answers 200 for a withdrawn user\'s export_personal_data with an empty user_state and the game scope rows that stay', async () => {
    server = await start();
    const { session, user_id } = await login(server, 'export_gone');
    await report_error(session, 'gone-error');
    await ban(server, user_id, 'gone-reason');
    await withdraw(server, user_id);
    const exported = await admin(server, 'export_personal_data', { user_id });
    expect(exported.status).toBe(200);
    expect(exported.json.user_state).toEqual({});
    const tables = exported.json.tables as Tables;
    expect(tables.admin_api_ban?.map((row) => row.reason)).toEqual(['gone-reason']);
    // `user` scope rows went with the withdrawal.
    expect(tables.logging_client_error).toEqual([]);
  });

  // Needs `iap` (payment records); this core has no iap module yet.
  it.skipIf(!has_module('iap'))('answers 200 for a withdrawn user\'s list_payments and keeps the payment record in export_personal_data', async () => {
    server = await start();
    const { user_id } = await login(server, 'export_paid');
    await withdraw(server, user_id);
    expect((await admin(server, 'list_payments', { user_id })).status).toBe(200);
    expect((await admin(server, 'list_payments', { user_id: MISSING_USER })).status).toBe(404);
  });
});
