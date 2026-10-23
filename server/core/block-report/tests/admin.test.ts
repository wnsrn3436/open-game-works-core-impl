import { advance_time, hold_game_row_lock, login, wait_background } from '../../testing/dev/index.ts';
import { REPORT_TABLE } from '../index.ts';
import { admin, list_body, list_reports, report_rows, report_user, START, start, stop_all, type ReportJson } from './kit.ts';

afterEach(async () => {
  await stop_all();
});

describe('resolve_report', () => {
  it('writes Resolved, resolution, resolved_at = clock time and expires_at = resolved_at + block-report.reportRetentionMs', async () => {
    const retention = 600_000;
    const instance = await start({ settings: { 'block-report.reportRetentionMs': retention } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    await report_user(alice, bob.user_id);
    const [report] = await list_reports(instance);
    advance_time(instance.server, 5000n);
    const result = await admin(instance, 'resolve_report', { operation_id: 'op-1', report_id: report?.report_id, resolution: 'warned the user' });
    expect(result).toEqual({ status: 200, json: {} });
    expect(await list_reports(instance)).toEqual([]);
    const [resolved] = await list_reports(instance, { status: 'Resolved' });
    const resolved_at = START + 5000n;
    expect(resolved).toEqual({ ...report, status: 'Resolved', resolution: 'warned the user', resolved_at: String(resolved_at), expires_at: String(resolved_at + BigInt(retention)) });
  });

  it('is conflict for a second operation_id and the first output for the same operation_id', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    await report_user(alice, bob.user_id);
    const [report] = await list_reports(instance);
    const body = { operation_id: 'op-1', report_id: report?.report_id, resolution: 'done' };
    const first = await admin(instance, 'resolve_report', body);
    expect(first).toEqual({ status: 200, json: {} });
    const other = await admin(instance, 'resolve_report', { ...body, operation_id: 'op-2' });
    expect(other).toEqual({ status: 409, json: { error: 'conflict' } });
    expect(await admin(instance, 'resolve_report', body)).toEqual(first);
    const [resolved] = await list_reports(instance, { status: 'Resolved' });
    expect(resolved?.resolution).toBe('done');
  });

  it('is not_found for a report that does not exist and bad_request for an empty resolution', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect(await admin(instance, 'resolve_report', { operation_id: 'op-1', report_id: '99', resolution: 'x' })).toEqual({ status: 404, json: { error: 'not_found' } });
    await report_user(alice, bob.user_id);
    const [report] = await list_reports(instance);
    expect(await admin(instance, 'resolve_report', { operation_id: 'op-2', report_id: report?.report_id, resolution: '' })).toEqual({ status: 400, json: { error: 'bad_request' } });
    expect((await list_reports(instance)).map((open) => open.status)).toEqual(['Open']);
  });

  it('is internal and changes nothing when the report row lock wait goes over its limit', async () => {
    const instance = await start({ settings: { 'storage.userLockWaitMs': 200 } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    await report_user(alice, bob.user_id);
    const [report] = await list_reports(instance);
    const body = { operation_id: 'op-1', report_id: report?.report_id, resolution: 'done' };
    const release = await hold_game_row_lock(instance.server, REPORT_TABLE, [BigInt(report?.report_id ?? '0')]);
    let held;
    try {
      held = await admin(instance, 'resolve_report', body);
    } finally {
      await release();
    }
    expect(held).toEqual({ status: 500, json: { error: 'internal' } });
    expect(await list_reports(instance)).toEqual([report]);
    expect(await admin(instance, 'resolve_report', body)).toEqual({ status: 200, json: {} });
  });

  it('lets a new report of the same target, ReportContext and ref in once the Open report is Resolved', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    await report_user(alice, bob.user_id, { ref: 'r' });
    const [report] = await list_reports(instance);
    await admin(instance, 'resolve_report', { operation_id: 'op-1', report_id: report?.report_id, resolution: 'done' });
    expect((await report_user(alice, bob.user_id, { ref: 'r' })).code).toBeNull();
    expect(await list_reports(instance)).toHaveLength(1);
  });
});

describe('list_reports', () => {
  it('returns the reports of the status in from_at <= created_at < to_at by (created_at, report_id) ascending', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    await report_user(alice, bob.user_id, { ref: 'a' });
    advance_time(instance.server, 1000n);
    await report_user(alice, bob.user_id, { ref: 'b' });
    await report_user(alice, bob.user_id, { ref: 'c' });
    advance_time(instance.server, 1000n);
    await report_user(alice, bob.user_id, { ref: 'd' });
    const all = await list_reports(instance);
    expect(all.map((report) => [report.ref, report.created_at])).toEqual([
      ['a', String(START)],
      ['b', String(START + 1000n)],
      ['c', String(START + 1000n)],
      ['d', String(START + 2000n)],
    ]);
    const middle = await list_reports(instance, { from_at: START + 1000n, to_at: START + 2000n });
    expect(middle.map((report) => report.ref)).toEqual(['b', 'c']);
    await admin(instance, 'resolve_report', { operation_id: 'op-1', report_id: all[0]?.report_id, resolution: 'done' });
    expect((await list_reports(instance)).map((report) => report.ref)).toEqual(['b', 'c', 'd']);
    expect((await list_reports(instance, { status: 'Resolved' })).map((report) => report.ref)).toEqual(['a']);
  });

  it('returns every report once when the cursor goes over more same created_at reports than limit', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    for (const ref of ['1', '2', '3', '4', '5']) expect((await report_user(alice, bob.user_id, { ref })).code).toBeNull();
    const seen: ReportJson[] = [];
    let page = await list_reports(instance, { limit: 2 });
    while (page.length > 0) {
      seen.push(...page);
      const last = page[page.length - 1] as ReportJson;
      page = await list_reports(instance, { limit: 2, after_created_at: last.created_at, after_report_id: last.report_id });
    }
    expect(seen.map((report) => report.ref)).toEqual(['1', '2', '3', '4', '5']);
    expect(new Set(seen.map((report) => report.created_at)).size).toBe(1);
  });

  it('is bad_request when only one cursor field is given', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    await report_user(alice, bob.user_id);
    const only_time = await admin(instance, 'list_reports', list_body({ after_created_at: String(START) }));
    expect(only_time).toEqual({ status: 400, json: { error: 'bad_request' } });
    const only_id = await admin(instance, 'list_reports', list_body({ after_report_id: '1' }));
    expect(only_id).toEqual({ status: 400, json: { error: 'bad_request' } });
  });

  it('is bad_request for an unknown status', async () => {
    const instance = await start();
    const body = { ...list_body({}), status: 'Closed' };
    expect((await admin(instance, 'list_reports', body)).status).toBe(400);
  });
});

describe('report expiry', () => {
  it('deletes a Resolved report once resolved_at + block-report.reportRetentionMs is reached and keeps an Open report of the same time', async () => {
    const retention = 60_000;
    const sweep = 1000;
    const instance = await start({ settings: { 'block-report.reportRetentionMs': retention, 'routing.storageSweepIntervalMs': sweep } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    await report_user(alice, bob.user_id, { ref: 'resolved' });
    await report_user(alice, bob.user_id, { ref: 'open' });
    const reports = await list_reports(instance);
    const resolved = reports.find((report) => report.ref === 'resolved');
    await admin(instance, 'resolve_report', { operation_id: 'op-1', report_id: resolved?.report_id, resolution: 'done' });

    advance_time(instance.server, BigInt(retention - sweep));
    await wait_background(instance.server);
    expect(report_rows(instance).map((row) => row.status)).toEqual(['Resolved', 'Open']);

    advance_time(instance.server, BigInt(2 * sweep));
    await wait_background(instance.server);
    const rows = report_rows(instance);
    expect(rows.map((row) => row.status)).toEqual(['Open']);
    expect(String(rows[0]?.report_id)).toBe(reports.find((report) => report.ref === 'open')?.report_id);
  });

  it('treats a Resolved report as missing once resolved_at + block-report.reportRetentionMs is reached, before the sweep deletes it', async () => {
    const retention = 60_000;
    const instance = await start({ settings: { 'block-report.reportRetentionMs': retention, 'routing.storageSweepIntervalMs': 100 * retention } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    await report_user(alice, bob.user_id, { ref: 'resolved' });
    await report_user(alice, bob.user_id, { ref: 'open' });
    const resolved = (await list_reports(instance)).find((report) => report.ref === 'resolved');
    const report_id = resolved?.report_id;
    expect((await admin(instance, 'resolve_report', { operation_id: 'op-1', report_id, resolution: 'done' })).status).toBe(200);

    advance_time(instance.server, BigInt(retention - 1));
    expect((await list_reports(instance, { status: 'Resolved' })).map((report) => report.report_id)).toEqual([report_id]);
    expect(await admin(instance, 'resolve_report', { operation_id: 'op-2', report_id, resolution: 'again' })).toEqual({ status: 409, json: { error: 'conflict' } });

    advance_time(instance.server, 1n);
    await wait_background(instance.server);
    expect(report_rows(instance).map((row) => row.status)).toEqual(['Resolved', 'Open']);
    expect(await list_reports(instance, { status: 'Resolved' })).toEqual([]);
    expect(await admin(instance, 'resolve_report', { operation_id: 'op-3', report_id, resolution: 'again' })).toEqual({ status: 404, json: { error: 'not_found' } });
    expect((await list_reports(instance)).map((report) => report.ref)).toEqual(['open']);
  });
});
