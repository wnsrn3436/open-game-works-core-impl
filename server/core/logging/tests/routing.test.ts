/**
 * Client log requests sent over HTTP through `routing`'s request processing order on a `testing` test server: the
 * session requirement and step 8, where a client log `rpc` is counted by `count_report_request` in place of the user
 * counter.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import { core_test_register, login, read_logs, send, start_test_server, stop_test_server, type TestServer, type TestSession } from '../../testing/dev/index.ts';
import { error_entry, report_errors, report_events } from './helpers.ts';

const START_AT = 1_800_000_000_000n;
const CoreError = CoreContract.CoreError;
const NO_TOKEN = { Authorization: null, 'X-Ogw-Timestamp': null, 'X-Ogw-Signature': null };
const UNKNOWN_TOKEN = { Authorization: 'Bearer not-an-access-token' };

interface Harness {
  readonly server: TestServer;
  storage(): Storage;
}

const running: TestServer[] = [];

async function start(settings: Record<string, unknown> = {}): Promise<Harness> {
  const register = (core: Readonly<Record<string, unknown>>): void => {
    core_test_register(core);
  };
  const server = await start_test_server(START_AT, undefined, undefined, undefined, undefined, settings, register);
  running.push(server);
  // Content `register(core)` gets only the member `content` of `storage`; the test reads rows through the module object.
  return { server, storage: () => storage_module(server) };
}

afterEach(async () => {
  for (const server of running.splice(0)) await stop_test_server(server);
});

let next_user = 0;

async function new_session(h: Harness): Promise<TestSession> {
  next_user += 1;
  return await login(h.server, `logging_routing_${String(next_user)}`);
}

async function code_of(session: TestSession, name: string, message: CoreContract.ReportClientErrorsRequest | CoreContract.ReportAnalyticsEventsRequest, headers?: Readonly<Record<string, string | null>>): Promise<number> {
  const { envelope } = await send(session, name, message, undefined, undefined, undefined, headers);
  return envelope.error?.code ?? 0;
}

function query(h: Harness, sql: string, user_id: bigint): Record<string, unknown>[] {
  return h.storage().read_db().query(sql, [user_id]);
}

function error_rows(h: Harness, user_id: bigint): number {
  return query(h, 'SELECT seq FROM logging_client_error WHERE user_id = $1', user_id).length;
}

function report_count(h: Harness, user_id: bigint): bigint | null {
  const row = query(h, 'SELECT count FROM logging_report_counter WHERE user_id = $1', user_id)[0];
  return row === undefined ? null : (row.count as bigint);
}

/** The sum of the user counter rows of `routing_rate_counter` for the user. */
function user_counter(h: Harness, user_id: bigint): bigint {
  const rows = h.storage().read_db().query("SELECT count FROM routing_rate_counter WHERE kind = 'user' AND target = $1", [user_id.toString()]);
  return rows.reduce<bigint>((sum, row) => sum + BigInt(row.count as bigint | number), 0n);
}

describe('client log request through routing', () => {
  it('refuses a ReportClientErrors without a session and stores no row', async () => {
    const h = await start();
    const session = await new_session(h);
    const message = report_errors([error_entry('error', 1n)]);
    // No `Authorization` breaks the common header format (step 3); a token that does not verify fails step 5.
    expect(await code_of(session, 'core/ReportClientErrors', message, NO_TOKEN)).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(await code_of(session, 'core/ReportClientErrors', message, UNKNOWN_TOKEN)).toBe(CoreError.CORE_ERROR_UNAUTHORIZED);
    expect(error_rows(h, session.user_id)).toBe(0);
    expect(report_count(h, session.user_id)).toBeNull();
  });

  it('counts a session client log request in logging_report_counter and leaves the routing user counter unchanged', async () => {
    const h = await start();
    const session = await new_session(h);
    const before = user_counter(h, session.user_id);
    expect(await code_of(session, 'core/ReportClientErrors', report_errors([error_entry('error', 1n)]))).toBe(0);
    expect(await code_of(session, 'core/ReportAnalyticsEvents', report_events([]))).toBe(0);
    expect(error_rows(h, session.user_id)).toBe(1);
    expect(report_count(h, session.user_id)).toBe(2n);
    expect(user_counter(h, session.user_id)).toBe(before);
  });

  it('ends the request over logging.reportRateLimitPerMinute with RATE_LIMITED and a security log, without the handler', async () => {
    const h = await start({ 'logging.reportRateLimitPerMinute': 2 });
    const session = await new_session(h);
    expect(await code_of(session, 'core/ReportClientErrors', report_errors([error_entry('error', 1n)]))).toBe(0);
    expect(await code_of(session, 'core/ReportClientErrors', report_errors([error_entry('error', 2n)]))).toBe(0);
    expect(await code_of(session, 'core/ReportClientErrors', report_errors([error_entry('error', 3n)]))).toBe(CoreError.CORE_ERROR_RATE_LIMITED);
    expect(error_rows(h, session.user_id)).toBe(2);
    expect(report_count(h, session.user_id)).toBe(3n);
    const security = read_logs(h.server, 'security').filter((line) => line.user_id === session.user_id.toString());
    expect(security).toHaveLength(1);
    expect(security[0]).toMatchObject({ request: 'core/ReportClientErrors', reason: 'rate_limited_user' });
  });
});
