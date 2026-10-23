import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { advance_time, hold_game_row_lock, login, read_logs } from '../../testing/dev/index.ts';
import { SEQUENCE_TABLE } from '../index.ts';
import { ABUSE, id_value, in_request, list_reports, report_rows, report_user, run_core_test, SPAM, start, stop_all } from './kit.ts';

const INVALID_REQUEST = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
const USER_NOT_FOUND = CoreContract.CoreError.CORE_ERROR_USER_NOT_FOUND;
const REPORT_LIMIT = CoreContract.CoreError.CORE_ERROR_REPORT_LIMIT;
const INTERNAL = CoreContract.CoreError.CORE_ERROR_INTERNAL;
const Context = CoreContract.ReportContext;

afterEach(async () => {
  await stop_all();
});

describe('ReportUser', () => {
  it('writes an Open report with the request fields, an empty evidence and created_at = request time', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const result = await report_user(alice, bob.user_id, { reason: ABUSE, context: Context.REPORT_CONTEXT_MATCH, ref: '42', comment: 'rude words' });
    expect(result.code).toBeNull();
    const reports = await list_reports(instance);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      reporter_id: String(alice.user_id),
      target_id: String(bob.user_id),
      reason_id: id_value(ABUSE),
      context: 'REPORT_CONTEXT_MATCH',
      ref: '42',
      comment: 'rude words',
      evidence: '',
      status: 'Open',
      created_at: String(result.server_time_at),
      resolution: '',
      expires_at: null,
    });
  });

  it('logs info with report_id, target user ID and reason_id', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await report_user(alice, bob.user_id)).code).toBeNull();
    const [report] = await list_reports(instance);
    const lines = read_logs(instance.server, 'core', 'info').filter((line) => line.module === 'block-report');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ user_id: String(alice.user_id), report_id: report?.report_id, target_id: String(bob.user_id), reason_id: id_value(SPAM) });
  });

  it('does not make another report for the same target, ReportContext and ref while the first is Open', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await report_user(alice, bob.user_id, { ref: 'r' })).code).toBeNull();
    expect((await report_user(alice, bob.user_id, { ref: 'r', reason: ABUSE, comment: 'again' })).code).toBeNull();
    expect(await list_reports(instance)).toHaveLength(1);
    // Another ref or another ReportContext is another report.
    expect((await report_user(alice, bob.user_id, { ref: 's' })).code).toBeNull();
    expect((await report_user(alice, bob.user_id, { ref: 'r', context: Context.REPORT_CONTEXT_GUILD })).code).toBeNull();
    expect(await list_reports(instance)).toHaveLength(3);
  });

  it('is REPORT_LIMIT when the fixed window count reaches block-report.maxReportsPerWindow, and takes reports again in the next window', async () => {
    const window = 60_000n;
    const instance = await start({ settings: { 'block-report.maxReportsPerWindow': 2, 'block-report.reportWindowMs': Number(window) } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await report_user(alice, bob.user_id, { ref: '1' })).code).toBeNull();
    expect((await report_user(alice, bob.user_id, { ref: '2' })).code).toBeNull();
    expect((await report_user(alice, bob.user_id, { ref: '3' })).code).toBe(REPORT_LIMIT);
    expect(await list_reports(instance)).toHaveLength(2);
    const warns = read_logs(instance.server, 'core', 'warn').filter((line) => line.module === 'block-report');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ user_id: String(alice.user_id), reporter_id: String(alice.user_id) });

    advance_time(instance.server, window);
    expect((await report_user(alice, bob.user_id, { ref: '3' })).code).toBeNull();
    expect(await list_reports(instance)).toHaveLength(3);
  });

  it('does not count a duplicate Open report toward the window count', async () => {
    const instance = await start({ settings: { 'block-report.maxReportsPerWindow': 1 } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await report_user(alice, bob.user_id, { ref: '1' })).code).toBeNull();
    expect((await report_user(alice, bob.user_id, { ref: '1' })).code).toBeNull();
    expect((await report_user(alice, bob.user_id, { ref: '2' })).code).toBe(REPORT_LIMIT);
  });

  it('gives different report_id values to reports two users send at the same time', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const carol = await login(instance.server, 'carol');
    const results = await Promise.all([report_user(alice, carol.user_id), report_user(bob, carol.user_id)]);
    expect(results.map((result) => result.code)).toEqual([null, null]);
    const reports = await list_reports(instance);
    expect(reports).toHaveLength(2);
    expect(new Set(reports.map((report) => report.report_id)).size).toBe(2);
    expect(new Set(reports.map((report) => report.reporter_id))).toEqual(new Set([String(alice.user_id), String(bob.user_id)]));
  });

  it('gives report_id values from 1 upward', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    for (const ref of ['a', 'b', 'c']) expect((await report_user(alice, bob.user_id, { ref })).code).toBeNull();
    expect((await list_reports(instance)).map((report) => report.report_id)).toEqual(['1', '2', '3']);
  });

  it('is INVALID_REQUEST for a reason_id not in report_reason, an _UNSPECIFIED context or a comment that is not plain text', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const unknown_reason = Math.max(id_value(SPAM), id_value(ABUSE)) + 1000;
    expect((await report_user(alice, bob.user_id, { reason_id: unknown_reason })).code).toBe(INVALID_REQUEST);
    expect((await report_user(alice, bob.user_id, { context: Context.REPORT_CONTEXT_UNSPECIFIED })).code).toBe(INVALID_REQUEST);
    expect((await report_user(alice, bob.user_id, { comment: ' leading space' })).code).toBe(INVALID_REQUEST);
    expect((await report_user(alice, bob.user_id, { comment: 'bell\u0007' })).code).toBe(INVALID_REQUEST);
    expect(report_rows(instance)).toEqual([]);
    // An empty comment is allowed.
    expect((await report_user(alice, bob.user_id, { comment: '' })).code).toBeNull();
  });

  it('is INVALID_REQUEST for the own user ID and user ID 0, USER_NOT_FOUND for a user that does not exist', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    expect((await report_user(alice, alice.user_id)).code).toBe(INVALID_REQUEST);
    expect((await report_user(alice, 0n)).code).toBe(INVALID_REQUEST);
    expect((await report_user(alice, alice.user_id + 1_000_000n)).code).toBe(USER_NOT_FOUND);
    expect(report_rows(instance)).toEqual([]);
  });
});

describe('add_report', () => {
  it('writes the evidence a content handler gives, and list_reports returns it', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const result = await in_request(instance, alice, (ctx) =>
      instance.block.add_report(ctx, bob.user_id, id_value(SPAM), Context.REPORT_CONTEXT_OTHER, 'room:7', '', 'buy gold at example'),
    );
    expect(result).toBe('OK');
    const reports = await list_reports(instance);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ context: 'REPORT_CONTEXT_OTHER', ref: 'room:7', evidence: 'buy gold at example' });
  });

  it('is INVALID_INPUT with no report row and an error log for an evidence over block-report.maxEvidenceBytes', async () => {
    const instance = await start({ settings: { 'block-report.maxEvidenceBytes': 8 } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    // Eight bytes in four code points fit; nine bytes do not.
    const fits = await in_request(instance, alice, (ctx) => instance.block.add_report(ctx, bob.user_id, id_value(SPAM), Context.REPORT_CONTEXT_OTHER, 'a', '', 'éééé'));
    expect(fits).toBe('OK');
    const over = await in_request(instance, alice, (ctx) => instance.block.add_report(ctx, bob.user_id, id_value(SPAM), Context.REPORT_CONTEXT_OTHER, 'b', '', 'éééé!'));
    expect(over).toBe('INVALID_INPUT');
    expect(report_rows(instance).map((row) => row.evidence)).toEqual(['éééé']);
    const errors = read_logs(instance.server, 'error', 'error');
    expect(errors.map((line) => [line.request, line.message])).toEqual([['RunCoreTest', 'add_report got an invalid input']]);
  });

  it('is INVALID_INPUT for a ref over block-report.maxRefBytes, an unknown reason_id and an _UNSPECIFIED context', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const results = await in_request(instance, alice, (ctx) => [
      instance.block.add_report(ctx, bob.user_id, id_value(SPAM), Context.REPORT_CONTEXT_CHAT, 'x'.repeat(129), '', ''),
      instance.block.add_report(ctx, bob.user_id, 0, Context.REPORT_CONTEXT_CHAT, '', '', ''),
      instance.block.add_report(ctx, bob.user_id, id_value(SPAM), Context.REPORT_CONTEXT_UNSPECIFIED, '', '', ''),
      instance.block.add_report(ctx, bob.user_id, id_value(SPAM), Context.REPORT_CONTEXT_CHAT, '', ' x', ''),
    ]);
    expect(results).toEqual(['INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT']);
    expect(report_rows(instance)).toEqual([]);
  });

  it('is LIMIT once the window count reaches block-report.maxReportsPerWindow', async () => {
    const instance = await start({ settings: { 'block-report.maxReportsPerWindow': 1 } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const results = await in_request(instance, alice, (ctx) => [
      instance.block.add_report(ctx, bob.user_id, id_value(SPAM), Context.REPORT_CONTEXT_CHAT, '1', '', 'one'),
      instance.block.add_report(ctx, bob.user_id, id_value(SPAM), Context.REPORT_CONTEXT_CHAT, '2', '', 'two'),
    ]);
    expect(results).toEqual(['OK', 'LIMIT']);
  });
});

describe('report_id sequence lock', () => {
  it('ends the request INTERNAL with no report row when the block_report_sequence row lock wait goes over its limit', async () => {
    const instance = await start({ settings: { 'storage.userLockWaitMs': 200 } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const release = await hold_game_row_lock(instance.server, SEQUENCE_TABLE, [0n]);
    let by_rpc;
    let by_content;
    try {
      by_rpc = await report_user(alice, bob.user_id, { ref: 'rpc' });
      by_content = await run_core_test(instance, alice, (ctx) =>
        instance.block.add_report(ctx, bob.user_id, id_value(SPAM), Context.REPORT_CONTEXT_OTHER, 'content', '', 'text'),
      );
    } finally {
      await release();
    }
    expect(by_rpc.code).toBe(INTERNAL);
    expect(by_content.code).toBe(INTERNAL);
    expect(report_rows(instance)).toEqual([]);
    expect((await report_user(alice, bob.user_id, { ref: 'rpc' })).code).toBeNull();
    expect(report_rows(instance)).toHaveLength(1);
  });
});
