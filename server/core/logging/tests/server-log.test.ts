import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { truncate_ip } from '../index.ts';
import {
  advance,
  analytics_event,
  CoreError,
  error_entry,
  logs,
  new_user,
  report_analytics_events,
  report_client_errors,
  report_errors,
  report_events,
  request,
  request_line,
  start,
  stop_all,
  type Server,
} from './helpers.ts';

afterEach(() => {
  stop_all();
});

const COMMON = ['time', 'level', 'kind', 'user_id', 'request_id', 'request', 'message'];
const WINDOW_MS = 60_000n;

function security(server: Server, user_id: bigint | null, ip: string, reason: string): void {
  server.logging.write({ kind: 'security', level: 'warn', message: `refused: ${reason}`, user_id, request_id: null, request: 'core/Resync', fields: { ip, reason } });
}

describe('request log', () => {
  it('has one line with every common field for each request', async () => {
    const server = await start();
    const user_id = await new_user(server);
    const results = [
      await request(server, user_id, 'Resync', () => new CoreContract.ResyncResponse()),
      await report_client_errors(server, user_id, report_errors([error_entry('error', 5n)])),
      await report_analytics_events(server, user_id, report_events([analytics_event('core_fake', 5n)])),
    ];
    expect(results.map((r) => r.code)).toEqual([0, 0, CoreError.CORE_ERROR_INVALID_REQUEST]);
    expect(logs(server, 'request')).toHaveLength(3);
    for (const result of results) {
      const line = request_line(server, result.request_id);
      expect(Object.keys(line).slice(0, COMMON.length)).toEqual(COMMON);
      expect(line.kind).toBe('request');
      expect(line.user_id).toBe(user_id.toString());
      expect(line.time).toBe(Number(server.clock.now()));
      expect(line).toMatchObject({ client_version: '1.2.3', platform: 'android', duration_ms: 1 });
    }
    expect(request_line(server, results[1]?.request_id as string)).toMatchObject({ request: 'core/ReportClientErrors', error_code: 0, dropped_count: 0, client_dropped_count: 0, consent_dropped_count: 0 });
  });

  it('is info for a success and a GameError, error for INTERNAL, and takes the annotated minimum level and fields', async () => {
    const server = await start();
    const user_id = await new_user(server);
    const ok = await request(server, user_id, 'Resync', () => new CoreContract.ResyncResponse());
    const game_error = await request(server, user_id, 'Resync', () => 3);
    const internal = await request(server, user_id, 'Resync', () => {
      throw new Error('logging test failure');
    });
    const annotated = await request(server, user_id, 'Resync', (ctx) => {
      expect(server.logging.annotate_request_log(ctx, { stage: 'boss', retry_count: 2 }, 'warn')).toBeNull();
      server.logging.annotate_request_log(ctx, { retry_count: 3, cached: true, big: 2 ** 62 }, 'info');
      return new CoreContract.ResyncResponse();
    });
    expect([ok.code, game_error.code, internal.code, annotated.code]).toEqual([0, 3, CoreError.CORE_ERROR_INTERNAL, 0]);
    expect(request_line(server, ok.request_id).level).toBe('info');
    expect(request_line(server, game_error.request_id)).toMatchObject({ level: 'info', error_code: 3 });
    expect(request_line(server, internal.request_id)).toMatchObject({ level: 'error', error_code: CoreError.CORE_ERROR_INTERNAL });
    expect(request_line(server, annotated.request_id)).toMatchObject({ level: 'warn', stage: 'boss', retry_count: 3, cached: true, big: (2n ** 62n).toString() });
  });

  it('keeps the annotation of a rolled back transaction, and a ctx without one has no fields and minimum level debug', async () => {
    const server = await start();
    const user_id = await new_user(server);
    const rolled_back = await request(server, user_id, 'Resync', (ctx) => {
      server.logging.annotate_request_log(ctx, { stage: 'boss' }, 'error');
      return 3;
    });
    expect(request_line(server, rolled_back.request_id)).toMatchObject({ level: 'error', stage: 'boss', error_code: 3 });
    await request(server, user_id, 'Resync', (ctx) => {
      expect(server.logging.take_request_log_annotation(ctx)).toEqual({ fields: {}, min_level: 'debug' });
      return new CoreContract.ResyncResponse();
    });
  });

  it('makes a request INTERNAL when annotate_request_log breaks a rule', async () => {
    const server = await start();
    const user_id = await new_user(server);
    const bad = [{ seed: 'x' }, { error_code: 1 }, { user_id: 1 }, { Stage: 'x' }, { ratio: 0.5 }, { list: [1] }];
    for (const fields of bad) {
      const result = await request(server, user_id, 'Resync', (ctx) => {
        server.logging.annotate_request_log(ctx, fields, 'info');
        return new CoreContract.ResyncResponse();
      });
      expect(result.code).toBe(CoreError.CORE_ERROR_INTERNAL);
    }
    const bad_level = await request(server, user_id, 'Resync', (ctx) => {
      server.logging.annotate_request_log(ctx, {}, 'fatal' as 'info');
      return new CoreContract.ResyncResponse();
    });
    expect(bad_level.code).toBe(CoreError.CORE_ERROR_INTERNAL);
  });

  it('has the decimal string of the seed given for the request', async () => {
    const seeds = new Map([['seeded-1', 9_007_199_254_740_993n], ['seeded-2', 42n]]);
    const server = await start({ seed: (id) => seeds.get(id) ?? null });
    const user_id = await new_user(server);
    for (const [request_id, seed] of seeds) {
      const result = await request(server, user_id, 'Resync', () => new CoreContract.ResyncResponse(), { request_id });
      expect(request_line(server, result.request_id).seed).toBe(seed.toString());
    }
  });
});

describe('error log', () => {
  it('has the stack trace of each unhandled exception, and null for an error that is not one', async () => {
    const server = await start();
    const user_id = await new_user(server);
    const first = await request(server, user_id, 'Resync', () => {
      throw new Error('first failure');
    });
    const second = await request(server, user_id, 'Resync', () => {
      throw new RangeError('second failure');
    });
    const errors = logs(server, 'error');
    expect(errors).toHaveLength(2);
    expect(errors.map((line) => line.request_id)).toEqual([first.request_id, second.request_id]);
    expect(errors[0]?.stack_trace).toContain('first failure');
    expect(errors[1]?.stack_trace).toContain('RangeError');
    server.logging.write({ kind: 'error', level: 'error', message: 'job failed', user_id: null, request_id: null, request: null, fields: null });
    expect(logs(server, 'error')[2]).toMatchObject({ level: 'error', user_id: null, request_id: null, request: null, message: 'job failed', stack_trace: null });
  });
});

describe('environments', () => {
  it('in STG has no debug log, no request_body, and no token or signature', async () => {
    const server = await start({ env: 'STG', analytics: null });
    const user_id = await new_user(server);
    const token = 'access-token-1234567890';
    const signature = 'signature-abcdef';
    const result = await request(
      server,
      user_id,
      'Resync',
      (ctx) => {
        server.logging.log(ctx, 'debug', 'debug detail', { step: 1 });
        server.logging.log(ctx, 'info', 'info detail', { step: 2 });
        server.logging.annotate_request_log(ctx, { stage: 'boss' }, 'debug');
        return new CoreContract.ResyncResponse();
      },
      { body: new TextEncoder().encode(`${token}.${signature}`) },
    );
    server.logging.write({ kind: 'core', level: 'debug', message: 'core debug', user_id: null, request_id: null, request: null, fields: { module: 'storage' } });
    expect(result.code).toBe(0);
    expect(server.lines.length).toBeGreaterThan(0);
    for (const line of logs(server)) expect(line.level).not.toBe('debug');
    expect(logs(server, 'game').map((line) => line.message)).toEqual(['info detail']);
    expect(request_line(server, result.request_id)).not.toHaveProperty('request_body');
    for (const line of server.lines) {
      expect(line).not.toContain(token);
      expect(line).not.toContain(signature);
      expect(line).not.toContain(Buffer.from(token).toString('base64').slice(0, 16));
    }
  });

  it('in DEV has request_body as base64 except for (ogw.sensitive) requests such as core/Login and core/VerifyPurchase', async () => {
    const server = await start({ env: 'DEV', analytics: null });
    const user_id = await new_user(server);
    const body = new CoreContract.ResyncRequest().encode();
    const sensitive_body = new TextEncoder().encode('credential');
    const plain = await request(server, user_id, 'Resync', () => new CoreContract.ResyncResponse(), { body });
    const login = await request(server, user_id, 'Login', () => new CoreContract.ResyncResponse(), { body: sensitive_body, sensitive: true });
    const purchase = await request(server, user_id, 'VerifyPurchase', () => new CoreContract.ResyncResponse(), { body: sensitive_body, sensitive: true });
    const login_rpc = CoreContract.RPCS.find((rpc) => rpc.name === 'core/Login');
    const purchase_rpc = CoreContract.RPCS.find((rpc) => rpc.name === 'core/VerifyPurchase');
    expect([login_rpc?.sensitive, purchase_rpc?.sensitive, CoreContract.RPCS.find((rpc) => rpc.name === 'core/Resync')?.sensitive]).toEqual([true, true, false]);
    expect(request_line(server, plain.request_id).request_body).toBe(Buffer.from(body).toString('base64'));
    expect(request_line(server, login.request_id)).not.toHaveProperty('request_body');
    expect(request_line(server, purchase.request_id)).not.toHaveProperty('request_body');
    server.logging.write({ kind: 'core', level: 'debug', message: 'core debug', user_id: null, request_id: null, request: null, fields: { module: 'storage' } });
    expect(logs(server, 'core').at(-1)).toMatchObject({ level: 'debug', module: 'storage' });
  });
});

describe('security log', () => {
  it('keeps the first line of N in a window for a user and reason; the flush job writes one summary with count N - 1', async () => {
    const server = await start();
    const user_id = await new_user(server);
    const ips = ['203.0.113.77', '203.0.113.90', '198.51.100.4', '2001:db8:85a3:8d3::1'];
    for (const ip of ips) security(server, user_id, ip, 'session_replaced');
    security(server, user_id, '203.0.113.5', 'other_reason');
    let lines = logs(server, 'security');
    expect(lines.map((line) => line.reason)).toEqual(['session_replaced', 'other_reason']);
    expect(lines[0]).toMatchObject({ user_id: user_id.toString(), ip: '203.0.113.0' });
    await advance(server, 2n * WINDOW_MS);
    lines = logs(server, 'security').filter((line) => line.reason === 'repeated');
    expect(lines).toEqual([
      expect.objectContaining({ level: 'warn', user_id: user_id.toString(), message: 'session_replaced', count: ips.length - 1, ips: ['203.0.113.0', '198.51.100.0', '2001:db8:85a3::'] }),
    ]);
    security(server, user_id, '203.0.113.77', 'session_replaced');
    expect(logs(server, 'security').filter((line) => line.reason === 'session_replaced')).toHaveLength(2);
  });

  it('groups lines of requests without a user by truncated IP, and a window of one line has no summary', async () => {
    const server = await start();
    security(server, null, '192.0.2.10', 'rate_limited_ip');
    security(server, null, '192.0.2.200', 'rate_limited_ip');
    security(server, null, '192.0.3.10', 'rate_limited_ip');
    expect(logs(server, 'security').map((line) => [line.ip, line.user_id])).toEqual([
      ['192.0.2.0', null],
      ['192.0.3.0', null],
    ]);
    await advance(server, 2n * WINDOW_MS);
    const summaries = logs(server, 'security').filter((line) => line.reason === 'repeated');
    expect(summaries).toEqual([expect.objectContaining({ user_id: null, message: 'rate_limited_ip', count: 1, ips: ['192.0.2.0'] })]);
  });

  it('has truncated IPs in ip and in the summary ips, at most logging.maxRepeatedIps of them', async () => {
    const server = await start({ settings: { 'logging.maxRepeatedIps': 2 } });
    const user_id = await new_user(server);
    const ips = ['203.0.113.77', '198.51.100.9', '2001:db8:85a3:8d3:1319:8a2e:370:7348', '192.0.2.1'];
    for (const ip of ips) security(server, user_id, ip, 'bad_signature');
    await advance(server, 2n * WINDOW_MS);
    const [first, summary] = logs(server, 'security');
    expect(first?.ip).toBe(truncate_ip('203.0.113.77'));
    expect(summary?.ips).toEqual([truncate_ip('198.51.100.9'), truncate_ip('2001:db8:85a3:8d3:1319:8a2e:370:7348')]);
    for (const ip of ips) expect(server.lines.join('\n')).not.toContain(ip);
  });

  it('gives a security line without ip the truncated client IP of with_request_ip inside its function, after awaits too, and null outside', async () => {
    const server = await start();
    const user_id = await new_user(server);
    const line = (reason: string, fields: Record<string, string | null> = {}): void => {
      server.logging.write({ kind: 'security', level: 'warn', message: reason, user_id, request_id: null, request: 'core/Resync', fields: { reason, ...fields } });
    };
    line('outside_before');
    const result = await server.logging.with_request_ip('203.0.113.77', async () => {
      line('inside');
      await new Promise((resolve) => setTimeout(resolve, 1));
      line('after_await');
      line('own_ip', { ip: '198.51.100.9' });
      line('own_null', { ip: null });
      return 7;
    });
    const sync_result = server.logging.with_request_ip('192.0.2.10', () => {
      line('inside_sync');
      return 'sync';
    });
    line('outside_after');
    expect(result).toBe(7);
    expect(sync_result).toBe('sync');
    expect(logs(server, 'security').map((entry) => [entry.reason, entry.ip])).toEqual([
      ['outside_before', null],
      ['inside', '203.0.113.0'],
      ['after_await', '203.0.113.0'],
      ['own_ip', '198.51.100.0'],
      ['own_null', null],
      ['inside_sync', '192.0.2.0'],
      ['outside_after', null],
    ]);
    expect(server.lines.join('\n')).not.toContain('203.0.113.77');
  });

  it('has truncate_ip as a module operation: the truncated IP, or an empty string for a string that is not an IP address', async () => {
    const server = await start();
    expect(server.logging.truncate_ip('203.0.113.77')).toBe('203.0.113.0');
    expect(server.logging.truncate_ip('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
    expect(server.logging.truncate_ip('not-an-ip')).toBe('');
  });
});

describe('game, core and audit log', () => {
  it('writes a game log with the content fields and drops bad fields with a warn log', async () => {
    const server = await start();
    const user_id = await new_user(server);
    const result = await request(server, user_id, 'Resync', (ctx) => {
      expect(server.logging.log(ctx, 'info', 'stage cleared', { stage: 3, boss: 'ogre', first: true, score: 2 ** 53, low: -(2 ** 62), BadKey: 1, user_id: 5, ratio: 0.5, huge: 2 ** 63 })).toBeNull();
      return new CoreContract.ResyncResponse();
    });
    const game = logs(server, 'game');
    expect(game).toEqual([
      { time: Number(server.clock.now()), level: 'info', kind: 'game', user_id: user_id.toString(), request_id: result.request_id, request: 'core/Resync', message: 'stage cleared', stage: 3, boss: 'ogre', first: true, score: (2n ** 53n).toString(), low: (-(2n ** 62n)).toString() },
    ]);
    expect(logs(server, 'core')).toEqual([expect.objectContaining({ level: 'warn', module: 'logging', dropped_count: 4 })]);
  });

  it('gives an audit log the actor of the entry, of with_audit_actor, or system', async () => {
    const server = await start();
    const audit = (actor?: string | null): void => {
      const written = server.logging.write({ kind: 'audit', level: 'info', message: 'grant', user_id: null, request_id: null, request: null, fields: actor === undefined ? { operation: 'grant_items' } : { operation: 'grant_items', actor } });
      expect(written).toBeNull();
    };
    audit();
    const result = await server.logging.with_audit_actor('alice', async () => {
      await Promise.resolve();
      audit();
      audit('bob');
      audit(null);
      return 7;
    });
    audit();
    audit(null);
    expect(result).toBe(7);
    // An entry's own `actor` is kept even when it is null.
    expect(logs(server, 'audit').map((line) => line.actor)).toEqual(['system', 'alice', 'bob', null, 'system', null]);
  });
});
