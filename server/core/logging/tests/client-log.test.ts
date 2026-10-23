import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  admin_list,
  advance,
  analytics_event,
  CoreError,
  DB_KIND,
  double_param,
  error_entry,
  int_param,
  lock_holder,
  MINUTE_MS,
  new_user,
  report_analytics_events,
  report_client_errors,
  report_errors,
  report_events,
  request_line,
  rows,
  sent_events,
  set_consent,
  settle,
  START_TIME,
  start,
  stop_all,
  string_param,
  user,
  type Server,
} from './helpers.ts';

afterEach(() => {
  stop_all();
});

const Kind = CoreContract.AnalyticsParamKind;
const RETENTION_MS = 2_592_000_000n;

function count_rows(server: Server, table: string, user_id: bigint): number {
  return rows(server, `SELECT seq FROM ${table} WHERE user_id = $1`, [user_id]).length;
}

function report_count(server: Server, user_id: bigint): bigint | null {
  const row = rows(server, 'SELECT count FROM logging_report_counter WHERE user_id = $1', [user_id])[0];
  return row === undefined ? null : (row.count as bigint);
}

describe('client log request', () => {
  it('stores nothing for a ctx that is not a request transaction of the user (the rpcs are handled only in a session request)', async () => {
    const server = await start();
    const user_id = await new_user(server);
    let ended: Parameters<typeof server.logging.ReportClientErrors>[0] | null = null;
    await server.storage.run_user_transaction(user_id, (ctx) => {
      ended = ctx;
      return 'pass';
    });
    expect(() => server.logging.ReportClientErrors(ended as never, report_errors([error_entry('error', 1n)]))).toThrow();
    expect(count_rows(server, 'logging_client_error', user_id)).toBe(0);
  });

  it('with a limit exceeded or a name that is not snake_case stores nothing and is INVALID_REQUEST', async () => {
    const server = await start();
    const user_id = await user(server);
    const too_many = report_errors(Array.from({ length: 51 }, (_, i) => error_entry('error', BigInt(i))));
    const long_message = report_errors([error_entry('error', 1n), error_entry('error', 2n, 'x'.repeat(1001))]);
    const too_many_params = report_events([analytics_event('ok_event', 1n), analytics_event('stage', 1n, Array.from({ length: 21 }, (_, i) => int_param(`p${String(i)}`, 1n)))]);
    const long_value = report_events([analytics_event('stage', 1n, [string_param('boss', 'x'.repeat(101))])]);
    const not_snake = [report_events([analytics_event('ok_event', 1n), analytics_event('StageClear', 1n)]), report_events([analytics_event('stage', 1n, [int_param('Score', 1n)])])];
    expect((await report_client_errors(server, user_id, too_many)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await report_client_errors(server, user_id, long_message)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await report_analytics_events(server, user_id, too_many_params)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await report_analytics_events(server, user_id, long_value)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    for (const message of not_snake) expect((await report_analytics_events(server, user_id, message)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    await settle(server);
    expect(count_rows(server, 'logging_client_error', user_id)).toBe(0);
    expect(count_rows(server, 'logging_client_event', user_id)).toBe(0);
    expect(sent_events(server)).toEqual([]);
  });

  it('drops only the mismatched params; the other params and events are stored, dropped_count is in the request log at warn', async () => {
    const server = await start();
    const user_id = await user(server);
    const mismatched = Object.assign(new CoreContract.AnalyticsParam(), { key: 'bad', kind: Kind.ANALYTICS_PARAM_KIND_INT, string_value: 'x' });
    const message = report_events([
      analytics_event('stage_clear', 10n, [int_param('stage', 3n), mismatched, double_param('ratio', Number.NaN), string_param('boss', 'ogre'), int_param('stage', 4n)]),
      analytics_event('shop_open', 11n, [string_param('tab', 'gems')]),
    ]);
    const result = await report_analytics_events(server, user_id, message);
    expect(result.code).toBe(0);
    const stored = rows(server, 'SELECT seq, name, params FROM logging_client_event WHERE user_id = $1 ORDER BY seq', [user_id]);
    expect(stored.map((row) => [row.seq, row.name])).toEqual([
      [1n, 'stage_clear'],
      [2n, 'shop_open'],
    ]);
    const params = CoreContract.AnalyticsEvent.decode(stored[0]?.params as Uint8Array)?.params ?? [];
    expect(params.map((p) => [p.key, p.kind])).toEqual([
      ['stage', Kind.ANALYTICS_PARAM_KIND_INT],
      ['boss', Kind.ANALYTICS_PARAM_KIND_STRING],
    ]);
    expect(request_line(server, result.request_id)).toMatchObject({ level: 'warn', dropped_count: 3, client_dropped_count: 0, consent_dropped_count: 0 });
    expect(server.lines.join('\n')).not.toContain('"bad"');
  });

  it('drops only a ClientErrorEntry with level info; the others are stored, dropped_count 1 at warn', async () => {
    const server = await start();
    const user_id = await new_user(server);
    const result = await report_client_errors(server, user_id, report_errors([error_entry('error', 1n, 'first'), error_entry('info', 2n, 'secret info text'), error_entry('warn', 3n, 'third')]));
    expect(result.code).toBe(0);
    const stored = rows(server, 'SELECT * FROM logging_client_error WHERE user_id = $1 ORDER BY seq', [user_id]);
    expect(stored.map((row) => [row.seq, row.level, row.message])).toEqual([
      [1n, 'error', 'first'],
      [2n, 'warn', 'third'],
    ]);
    expect(stored[0]).toMatchObject({ time_at: 1n, received_at: START_TIME, client_version: '1.2.3', platform: 'android', tag: 'battle', stack_trace: 'at frame 1', expires_at: START_TIME + RETENTION_MS });
    expect(request_line(server, result.request_id)).toMatchObject({ level: 'warn', dropped_count: 1 });
    expect(server.lines.join('\n')).not.toContain('secret info text');
  });

  it('puts the client queue drops in client_dropped_count and raises the level to warn', async () => {
    const server = await start();
    const user_id = await user(server);
    const errors = await report_client_errors(server, user_id, report_errors([error_entry('error', 1n)], 4));
    const none = await report_client_errors(server, user_id, report_errors([error_entry('error', 1n)], 0));
    const events = await report_analytics_events(server, user_id, report_events([analytics_event('a', 1n)], 2));
    expect(request_line(server, errors.request_id)).toMatchObject({ level: 'warn', client_dropped_count: 4, dropped_count: 0 });
    expect(request_line(server, none.request_id)).toMatchObject({ level: 'info', client_dropped_count: 0 });
    expect(request_line(server, events.request_id)).toMatchObject({ level: 'warn', client_dropped_count: 2 });
  });
});

describe('report counter', () => {
  it('counts each client log request in logging_report_counter of the minute window, apart from the user counter', async () => {
    const server = await start();
    const user_id = await new_user(server);
    await report_client_errors(server, user_id, report_errors([]));
    await report_analytics_events(server, user_id, report_events([]));
    expect(rows(server, 'SELECT * FROM logging_report_counter WHERE user_id = $1', [user_id])).toEqual([
      { user_id, window_start: (START_TIME / MINUTE_MS) * MINUTE_MS, count: 2n, expires_at: (START_TIME / MINUTE_MS + 1n) * MINUTE_MS },
    ]);
  });

  it('counts an INVALID_REQUEST request too, and the request over logging.reportRateLimitPerMinute is RATE_LIMITED without the handler', async () => {
    const server = await start({ settings: { 'logging.reportRateLimitPerMinute': 3 } });
    const user_id = await new_user(server);
    const window_end = (START_TIME / MINUTE_MS + 1n) * MINUTE_MS;
    await advance(server, window_end - START_TIME - 1000n);
    expect((await report_analytics_events(server, user_id, report_events([analytics_event('Bad', 1n)]))).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await report_client_errors(server, user_id, report_errors([error_entry('error', 1n)]))).code).toBe(0);
    expect((await report_client_errors(server, user_id, report_errors([error_entry('error', 2n)]))).code).toBe(0);
    const limited = await report_client_errors(server, user_id, report_errors([error_entry('error', 3n)]));
    expect(limited).toMatchObject({ code: CoreError.CORE_ERROR_RATE_LIMITED, handled: false });
    expect(request_line(server, limited.request_id).error_code).toBe(CoreError.CORE_ERROR_RATE_LIMITED);
    expect(count_rows(server, 'logging_client_error', user_id)).toBe(2);
    expect(report_count(server, user_id)).toBe(4n);
    await advance(server, 1000n);
    expect((await report_client_errors(server, user_id, report_errors([error_entry('error', 4n)]))).code).toBe(0);
    expect(report_count(server, user_id)).toBe(1n);
  });

  it('is INTERNAL without the handler and does not count when the user transaction is FAILED', async () => {
    const server = await start({ settings: { 'storage.userLockWaitMs': 200 } });
    const user_id = await new_user(server);
    await report_client_errors(server, user_id, report_errors([]));
    const holder = await lock_holder(server.db);
    if (DB_KIND === 'postgresql') {
      await holder.ok('BEGIN');
      await holder.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [user_id]);
    } else {
      await holder.ok('BEGIN IMMEDIATE');
    }
    const result = await report_client_errors(server, user_id, report_errors([error_entry('error', 1n)]));
    await holder.ok('ROLLBACK');
    expect(result).toMatchObject({ code: CoreError.CORE_ERROR_INTERNAL, handled: false });
    expect(report_count(server, user_id)).toBe(1n);
    expect(count_rows(server, 'logging_client_error', user_id)).toBe(0);
    const errors = server.lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.kind === 'error');
    expect(errors).toEqual([expect.objectContaining({ level: 'error', user_id: user_id.toString(), stack_trace: null })]);
  });

  it('is UNAUTHORIZED for a withdrawn user', async () => {
    const server = await start();
    const user_id = await new_user(server);
    await server.storage.run_user_transaction(user_id, (ctx) => {
      server.storage.delete_user(ctx);
      return 'pass';
    });
    expect(await server.logging.count_report_request(user_id)).toBe(CoreError.CORE_ERROR_UNAUTHORIZED);
  });

  it('writes count 1 over a row whose expires_at has passed but which is not swept yet', async () => {
    const server = await start({ settings: { 'logging.reportRateLimitPerMinute': 2 } });
    const user_id = await new_user(server);
    for (let i = 0; i < 3; i += 1) await report_client_errors(server, user_id, report_errors([]));
    expect(report_count(server, user_id)).toBe(3n);
    await advance(server, 5n * MINUTE_MS);
    expect(rows(server, 'SELECT count FROM logging_report_counter WHERE user_id = $1', [user_id])).toHaveLength(1);
    expect((await report_client_errors(server, user_id, report_errors([]))).code).toBe(0);
    expect(rows(server, 'SELECT window_start, count FROM logging_report_counter WHERE user_id = $1', [user_id])).toEqual([
      { window_start: ((START_TIME + 5n * MINUTE_MS) / MINUTE_MS) * MINUTE_MS, count: 1n },
    ]);
  });
});

describe('admin list of client logs', () => {
  /** Client errors of two users at `time_at` 100, 100, 100, 200, 300 (user a) and 100, 100 (user b). */
  async function fill(server: Server): Promise<{ a: bigint; b: bigint }> {
    const a = await new_user(server);
    const b = await new_user(server);
    const [first, second] = a < b ? [a, b] : [b, a];
    await report_client_errors(server, first, report_errors([100n, 100n, 100n, 200n, 300n].map((t) => error_entry('error', t))));
    await report_client_errors(server, second, report_errors([100n, 100n].map((t) => error_entry('error', t))));
    return { a: first, b: second };
  }

  const key = (entry: Record<string, unknown>): string => `${String(entry.time_at)}/${String(entry.user_id)}/${String(entry.seq)}`;

  it('returns the rows of [from_at, to_at) by (time_at, user_id, seq), at most limit, and the cursor walks every row once', async () => {
    const server = await start();
    const { a, b } = await fill(server);
    const all = await admin_list(server, 'list_client_errors', { from_at: 100n, to_at: 300n, limit: 100 });
    expect(Array.isArray(all) ? all.map(key) : all).toEqual([`100/${String(a)}/1`, `100/${String(a)}/2`, `100/${String(a)}/3`, `100/${String(b)}/1`, `100/${String(b)}/2`, `200/${String(a)}/4`]);
    const walked: string[] = [];
    let cursor: Record<string, unknown> = {};
    for (;;) {
      const page = await admin_list(server, 'list_client_errors', { from_at: 0n, to_at: 1000n, limit: 2, ...cursor });
      if (!Array.isArray(page)) throw new Error(page);
      expect(page.length).toBeLessThanOrEqual(2);
      if (page.length === 0) break;
      walked.push(...page.map(key));
      const last = page.at(-1) as Record<string, string>;
      cursor = { after_time_at: BigInt(last.time_at as string), after_user_id: BigInt(last.user_id as string), after_seq: BigInt(last.seq as string) };
    }
    expect(walked).toHaveLength(7);
    expect(new Set(walked).size).toBe(7);
    const for_b = await admin_list(server, 'list_client_errors', { user_id: b, from_at: 0n, to_at: 1000n, limit: 10 });
    expect(Array.isArray(for_b) ? for_b.map(key) : for_b).toEqual([`100/${String(b)}/1`, `100/${String(b)}/2`]);
  });

  it('is bad_request for a cursor with only some of its fields, or after_seq below 1', async () => {
    const server = await start();
    await fill(server);
    const base = { from_at: 0n, to_at: 1000n, limit: 10 };
    expect(await admin_list(server, 'list_client_errors', { ...base, after_time_at: 100n })).toBe('bad_request');
    expect(await admin_list(server, 'list_client_events', { ...base, after_time_at: 100n, after_user_id: 1n })).toBe('bad_request');
    expect(await admin_list(server, 'list_client_errors', { ...base, after_time_at: 100n, after_user_id: 1n, after_seq: 0n })).toBe('bad_request');
  });

  it('declares the three read operations with their input fields for admin-api', async () => {
    const server = await start();
    for (const name of ['list_client_errors', 'list_client_events', 'list_server_events'] as const) {
      const op = server.logging[name];
      expect(op).toMatchObject({ name, role: 'read', body: 'json', user_target: null });
      expect(op.input.from_at).toEqual({ type: { kind: 'int64' }, optional: false });
      expect(op.input.limit).toEqual({ type: { kind: 'int32' }, optional: false });
      expect(op.input.after_seq).toEqual({ type: { kind: 'int64' }, optional: true });
      expect('name' in op.input).toBe(name !== 'list_client_errors');
    }
  });

  it('returns every column of a list_client_events row, int64 as decimal strings, and params decode to the params sent', async () => {
    const server = await start();
    const user_id = await user(server);
    const params = [int_param('stage', 9_007_199_254_740_993n), string_param('boss', 'ogre'), double_param('ratio', 0.25)];
    await report_analytics_events(server, user_id, report_events([analytics_event('stage_clear', 1_000n, params)]), { client_version: '2.0.0', platform: 'ios' });
    const entries = await admin_list(server, 'list_client_events', { from_at: 0n, to_at: 2_000n, limit: 10, name: 'stage_clear' });
    if (!Array.isArray(entries)) throw new Error(entries);
    expect(entries).toEqual([
      {
        user_id: user_id.toString(),
        seq: '1',
        time_at: '1000',
        received_at: START_TIME.toString(),
        client_version: '2.0.0',
        platform: 'ios',
        name: 'stage_clear',
        params: expect.any(String) as unknown,
        expires_at: (START_TIME + RETENTION_MS).toString(),
      },
    ]);
    const decoded = CoreContract.AnalyticsEvent.decode(Uint8Array.from(Buffer.from(entries[0]?.params as string, 'base64')));
    expect(decoded?.params.map((p) => [p.key, p.kind, p.int_value, p.string_value, p.double_value])).toEqual(params.map((p) => [p.key, p.kind, p.int_value, p.string_value, p.double_value]));
    expect(await admin_list(server, 'list_client_events', { from_at: 0n, to_at: 2_000n, limit: 10, name: 'other' })).toEqual([]);
  });
});

describe('analytics adapter', () => {
  it('is not called in an environment without one, and the fake adapter gets the events as stored', async () => {
    const without = await start({ analytics: null, fake_override: true });
    const quiet = await user(without);
    expect((await report_analytics_events(without, quiet, report_events([analytics_event('a', 1n)]))).code).toBe(0);
    await settle(without);
    expect(without.fake?.calls()).toEqual([]);
    expect(count_rows(without, 'logging_client_event', quiet)).toBe(1);

    const server = await start();
    const user_id = await user(server);
    const params = [int_param('stage', 3n), string_param('boss', 'ogre')];
    await report_analytics_events(server, user_id, report_events([analytics_event('stage_clear', 5n, params), analytics_event('shop_open', 6n)]));
    await settle(server);
    const stored = rows(server, 'SELECT name, time_at, params FROM logging_client_event WHERE user_id = $1 ORDER BY seq', [user_id]);
    const sent = sent_events(server);
    expect(sent.map((e) => [e.user_id, e.name, e.time_at, e.params.length])).toEqual([
      [user_id, 'stage_clear', 5n, 2],
      [user_id, 'shop_open', 6n, 0],
    ]);
    expect(sent.map((e) => Buffer.from(params_of(e.params)).toString('hex'))).toEqual(stored.map((row) => Buffer.from(row.params as Uint8Array).toString('hex')));
  });

  it('does not change the request result when sending fails, and logs one warn per run of a failure kind', async () => {
    // `timeout` ends the fake call only when the logging.analyticsSendTimeoutMs time limit aborts.
    const server = await start({ settings: { 'logging.analyticsSendTimeoutMs': 30 } });
    const user_id = await user(server);
    server.fake?.set_failure('send', 'communication_failure');
    for (let i = 0; i < 2; i += 1) expect((await report_analytics_events(server, user_id, report_events([analytics_event('a', 1n)]))).code).toBe(0);
    await settle(server);
    server.fake?.set_failure('send', 'timeout');
    const started = performance.now();
    expect((await report_analytics_events(server, user_id, report_events([analytics_event('a', 1n)]))).code).toBe(0);
    await settle(server);
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
    expect(count_rows(server, 'logging_client_event', user_id)).toBe(3);
    const warns = server.lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.kind === 'core' && line.level === 'warn');
    expect(warns.map((line) => line.failure)).toEqual(['communication_failure', 'timeout']);
  });
});

/** The `params` column bytes of a param list. */
function params_of(params: readonly CoreContract.AnalyticsParam[]): Uint8Array {
  const event = new CoreContract.AnalyticsEvent();
  event.params = [...params];
  return event.encode();
}

describe('retention and consent', () => {
  it('deletes client log rows after the retention period, and lists do not return them before the sweep', async () => {
    const server = await start();
    const user_id = await user(server);
    await report_client_errors(server, user_id, report_errors([error_entry('error', 1n)]));
    await report_analytics_events(server, user_id, report_events([analytics_event('a', 1n)]));
    await advance(server, RETENTION_MS - 1n);
    await server.storage.sweep_expired();
    expect(count_rows(server, 'logging_client_error', user_id) + count_rows(server, 'logging_client_event', user_id)).toBe(2);
    expect(await admin_list(server, 'list_client_errors', { from_at: 0n, to_at: 10n, limit: 10 })).toHaveLength(1);
    await advance(server, 1n);
    expect(await admin_list(server, 'list_client_errors', { from_at: 0n, to_at: 10n, limit: 10 })).toEqual([]);
    expect(await admin_list(server, 'list_client_events', { from_at: 0n, to_at: 10n, limit: 10 })).toEqual([]);
    await server.storage.sweep_expired();
    expect(count_rows(server, 'logging_client_error', user_id)).toBe(0);
    expect(count_rows(server, 'logging_client_event', user_id)).toBe(0);
  });

  it('succeeds without storing or sending for a user without consent or with analytics_allowed false; events after consent are stored', async () => {
    const server = await start();
    const none = await new_user(server);
    const refused = await new_user(server);
    await set_consent(server, refused, false);
    const events = report_events([analytics_event('a', 1n), analytics_event('b', 2n), analytics_event('c', 3n)]);
    for (const user_id of [none, refused]) {
      const result = await report_analytics_events(server, user_id, events);
      expect(result.code).toBe(0);
      expect(request_line(server, result.request_id)).toMatchObject({ level: 'info', consent_dropped_count: 3, dropped_count: 0 });
    }
    await settle(server);
    expect(count_rows(server, 'logging_client_event', none) + count_rows(server, 'logging_client_event', refused)).toBe(0);
    expect(sent_events(server)).toEqual([]);
    await set_consent(server, refused, true);
    expect((await report_analytics_events(server, refused, events)).code).toBe(0);
    await settle(server);
    expect(count_rows(server, 'logging_client_event', refused)).toBe(3);
    expect(sent_events(server).map((e) => e.name)).toEqual(['a', 'b', 'c']);
  });

  it('stores nothing and is INVALID_REQUEST for a ReportAnalyticsEvents with an event name starting with core_', async () => {
    const server = await start();
    const user_id = await user(server);
    const result = await report_analytics_events(server, user_id, report_events([analytics_event('stage_clear', 1n), analytics_event('core_iap_granted', 2n)]));
    expect(result).toMatchObject({ code: CoreError.CORE_ERROR_INVALID_REQUEST, handled: true });
    await settle(server);
    expect(count_rows(server, 'logging_client_event', user_id)).toBe(0);
    expect(sent_events(server)).toEqual([]);
  });
});
