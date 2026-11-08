/**
 * `duration_ms` as `routing` measures it, and the metrics of requests sent over HTTP to a `testing` test server: real
 * elapsed time, so a handler that waits for a row that `testing.hold_db` holds is slow, and a test clock moved
 * during a request does not change it.
 */
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import { real_delay } from '../../testing/dev/real_time.ts';
import type { TestServer, TestSession } from '../../testing/dev/index.ts';
import type { Logging, MetricFamily } from '../index.ts';

const START_AT = 1_800_000_000_000n;
const CoreError = CoreContract.CoreError;

const running: TestServer[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) await testing.stop_test_server(server);
});

interface Harness {
  readonly server: TestServer;
  readonly session: TestSession;
}

/** A test server whose `RunCoreTest` handler runs `during` (with the test server) before it answers. */
async function start(settings: Record<string, unknown>, db: 'sqlite' | 'postgresql' | undefined, during: (server: TestServer) => void = () => undefined): Promise<Harness> {
  const box: { server: TestServer | null } = { server: null };
  const register = (core: Readonly<Record<string, unknown>>): void => {
    testing.core_test_register(core, ['RunCoreTest']);
    const routing = core.routing as { register_handler(name: string, handler: () => GameContract.RunCoreTestResponse): void };
    routing.register_handler('RunCoreTest', () => {
      if (box.server !== null) during(box.server);
      return new GameContract.RunCoreTestResponse();
    });
  };
  const server = await testing.start_test_server(START_AT, db, undefined, undefined, undefined, settings, register);
  running.push(server);
  box.server = server;
  const session = await testing.login(server, `logging_metrics_${String(running.length)}_${String(Date.now())}`);
  return { server, session };
}

function logging_of(server: TestServer): Logging {
  const logging = server.running().instance.modules().get('logging');
  if (logging === undefined) throw new Error('the server instance has no logging module');
  return logging as unknown as Logging;
}

function slow_firing(families: readonly MetricFamily[]): number | undefined {
  return families.find((f) => f.name === 'ogw_alert_firing')?.samples.find((s) => s.labels.alert === 'slow_requests')?.value;
}

async function run_core_test(session: TestSession): Promise<number> {
  const { envelope } = await testing.send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
  return envelope.error?.code ?? 0;
}

function run_core_test_lines(server: TestServer): Record<string, unknown>[] {
  return testing.read_logs(server, 'request').filter((line) => line.request === 'RunCoreTest');
}

describe('duration_ms of the request log', () => {
  it('is real elapsed time: a test clock moved during the request does not change it', async () => {
    const moved_ms = 600_000n;
    const { server, session } = await start({}, undefined, (s) => {
      testing.advance_time(s, moved_ms);
    });
    expect(await run_core_test(session)).toBe(0);
    const lines = run_core_test_lines(server);
    expect(lines).toHaveLength(1);
    const duration = lines[0]?.duration_ms as number;
    expect(Number.isInteger(duration)).toBe(true);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThan(Number(moved_ms));
  });

  it('makes slow_requests fire for a request that waits in real time for a row that testing.hold_db holds, and not for two fast requests', async () => {
    const slow_ms = 200;
    const window_ms = 60_000n;
    const settings = { 'logging.alertMinRequests': 2, 'logging.alertSlowRatioPermille': 500, 'logging.alertSlowRequestMs': slow_ms, 'logging.alertWindowMs': Number(window_ms), 'storage.userLockWaitMs': 1500 };
    const { server, session } = await start(settings, 'postgresql');
    const logging = logging_of(server);
    // The login lines leave the alert window.
    testing.advance_time(server, window_ms);
    expect(await run_core_test(session)).toBe(0);
    expect(await run_core_test(session)).toBe(0);
    for (const line of run_core_test_lines(server)) expect(line.duration_ms as number).toBeLessThanOrEqual(slow_ms);
    expect(slow_firing(logging.read_metrics())).toBe(0);
    testing.advance_time(server, window_ms);
    expect(await run_core_test(session)).toBe(0);
    const holder = await testing.hold_db(server, [{ sql: 'SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', params: [session.user_id] }]);
    let code: number;
    try {
      const sent = run_core_test(session);
      await real_delay(BigInt(slow_ms * 2));
      await holder.release();
      code = await sent;
    } finally {
      await holder.release();
    }
    // The request ends when the hold is released, or with INTERNAL at storage.userLockWaitMs when its DB call blocks the thread.
    expect([0, CoreError.CORE_ERROR_INTERNAL]).toContain(code);
    const last = run_core_test_lines(server).at(-1);
    expect(last?.duration_ms as number).toBeGreaterThan(slow_ms);
    expect(slow_firing(logging.read_metrics())).toBe(1);
  });

  it('labels the requests sent over HTTP by request name and error code, with no user ID or IP in a label', async () => {
    const { server, session } = await start({}, undefined);
    expect(await run_core_test(session)).toBe(0);
    const families = logging_of(server).read_metrics();
    const requests = families.find((f) => f.name === 'ogw_requests_total')?.samples ?? [];
    expect(requests.find((s) => s.labels.request === 'RunCoreTest')).toMatchObject({ labels: { request: 'RunCoreTest', error_code: '0' }, value: 1 });
    for (const f of families) {
      for (const sample of f.samples) {
        for (const value of Object.values(sample.labels)) {
          expect(value).not.toBe(session.user_id.toString());
          expect(value).not.toMatch(/^(127\.|::|::ffff:)/);
        }
      }
    }
  });
});

describe('the request label of cheat paths', () => {
  it('counts POST /cheat/a and POST /core/cheat/b of a STG server without DEV code under request cheat, and the log lines keep their request fields', async () => {
    const server = await testing.start_test_server(undefined, undefined, 'STG');
    running.push(server);
    // A test server of STG is a server instance without DEV code (`dev: false`, no `registerDev`).
    expect(server.environment).toBe('STG');
    const headers = { 'Content-Type': 'application/x-protobuf' };
    for (const path of ['/cheat/a', '/core/cheat/b']) {
      const response = await testing.send_raw(server, 'POST', path, { ...headers, 'X-Ogw-Request-Id': randomUUID() }, new Uint8Array(0));
      expect(response.status).toBe(200);
    }
    const lines = testing.read_logs(server, 'request');
    expect(lines.filter((line) => line.request === 'cheat/a')).toHaveLength(1);
    expect(lines.filter((line) => line.request === 'core/cheat/b')).toHaveLength(1);
    const code = String(CoreError.CORE_ERROR_UNAUTHORIZED);
    expect(lines.filter((line) => line.request === 'cheat/a' || line.request === 'core/cheat/b').map((line) => String(line.error_code))).toEqual([code, code]);
    const families = logging_of(server).read_metrics();
    const requests = families.find((f) => f.name === 'ogw_requests_total')?.samples ?? [];
    expect(requests.filter((s) => s.labels.request === 'cheat')).toEqual([{ name: 'ogw_requests_total', labels: { request: 'cheat', error_code: code }, value: 2 }]);
    const durations = families.find((f) => f.name === 'ogw_request_duration_seconds')?.samples ?? [];
    expect(durations.find((s) => s.name === 'ogw_request_duration_seconds_count' && s.labels.request === 'cheat')?.value).toBe(2);
    for (const f of [...requests, ...durations]) expect(f.labels.request).not.toMatch(/cheat\//);
  });
});

describe('settings check', () => {
  // Skipped until the settings check of `routing.create_server` (`### server start` of `routing`, the routing job of
  // this update) is on main: without it the server starts with an empty bucket list. Remove `.skip` with that merge.
  it.skip('fails server start for logging.metricsDurationBucketsMs [] with keyword minItems', async () => {
    const failure: unknown = await testing.start_test_server(START_AT, undefined, undefined, undefined, undefined, { 'logging.metricsDurationBucketsMs': [] }).then(
      async (server) => {
        await testing.stop_test_server(server);
        return null;
      },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(testing.StartFailure);
    expect((failure as Error).message).toContain('logging.metricsDurationBucketsMs');
    expect((failure as Error).message).toContain('minItems');
  });
});
