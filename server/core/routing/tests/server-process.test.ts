/**
 * The server process (`### server process`, `### ops path`): a front on the main thread and worker threads that each
 * make one server instance, started with the server process entry point or with `run_server_process`.
 */
import { writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { open_pg_session } from '../../storage/dev/index.ts';
import * as testing from '../../testing/dev/index.ts';
import { real_delay } from '../../testing/dev/real_time.ts';
import type { MetricFamily } from '../../logging/index.ts';
import { metrics_text } from '../server_process.ts';
import { accepts, driver, free_port, game_server, get, local_args, sample, start_point, until, type GameServer, type RunningProcess } from './process_support.ts';

const E = CoreContract.CoreError;
const PG = process.env.OGW_POSTGRESQL ?? null;
const TEST_MS = 120_000;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function game(kind: 'sqlite' | 'postgresql', settings: Readonly<Record<string, unknown>> = {}): Promise<GameServer> {
  const made = await game_server(kind, settings);
  cleanups.push(() => made.remove());
  return made;
}

function keep(running: RunningProcess): RunningProcess {
  cleanups.push(() => running.kill());
  return running;
}

/** A driver process of `run_server_process` that started; its ports. */
async function run_process(made: GameServer, args: Readonly<Record<string, unknown>>, env: Readonly<Record<string, string>> = {}): Promise<{ process: RunningProcess; port: number; ops_port: number | null }> {
  const { process: running, output } = await driver(made, args, env);
  keep(running);
  if (typeof output === 'string') throw new Error(`run_server_process failed: ${output}`);
  return { process: running, port: output.port, ops_port: output.ops_port };
}

async function remote(made: GameServer, port: number): Promise<testing.RemoteServer> {
  return testing.connect_server(`http://127.0.0.1:${String(port)}`, testing.core_test_server_paths().data_folder, made.input.secrets.dev_access);
}

function error_code(result: testing.SendResult): number {
  return result.envelope.error?.code ?? 0;
}

const resync = (): CoreContract.ResyncRequest => new CoreContract.ResyncRequest();

/** The first bytes a WebSocket upgrade of `GET /realtime` gets, or the empty string when the connection is closed without any. */
function realtime_upgrade(port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    let text = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write('GET /realtime HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    socket.on('data', (chunk: string) => {
      text += chunk;
      if (text.includes('\r\n')) socket.destroy();
    });
    socket.on('close', () => {
      resolve(text);
    });
    socket.on('error', () => undefined);
  });
}

/** A client of an upgrade request that keeps its side of the connection open after the answer. */
interface HeldUpgrade {
  /** The bytes received. */
  text(): string;
  /** True once the server ended its side. */
  ended(): boolean;
  /** Writes one byte while the connection is open, so that a connection the server closed ends with `close`; true once it closed. */
  closed(): boolean;
  destroy(): void;
}

/** Sends a WebSocket upgrade of `GET <path>` (without `Sec-WebSocket-Key` when `key` is false) on a connection whose client side stays open. */
function held_upgrade(port: number, path: string, key = true): HeldUpgrade {
  const socket = connect({ port, host: '127.0.0.1', allowHalfOpen: true });
  let text = '';
  let ended = false;
  let closed = false;
  socket.setEncoding('utf8');
  socket.on('connect', () => {
    socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${key ? 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' : ''}Sec-WebSocket-Version: 13\r\n\r\n`);
  });
  socket.on('data', (chunk: string) => {
    text += chunk;
  });
  socket.on('end', () => {
    ended = true;
  });
  socket.on('close', () => {
    closed = true;
  });
  socket.on('error', () => undefined);
  return {
    text: () => text,
    ended: () => ended,
    closed: () => {
      if (!closed && ended && !socket.destroyed) socket.write('x');
      return closed;
    },
    destroy: () => socket.destroy(),
  };
}

/**
 * A `POST` to `path` with a `Content-Length` of `total` bytes that sends 1 KiB, waits for the answer head, then sends
 * the rest in 1 MiB chunks until the connection closes: the answer head and the bytes sent in all.
 */
function stream_body(port: number, path: string, total: number): Promise<{ head: string; sent: number }> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    let head = '';
    let sent = 0;
    let closed = false;
    const chunk = Buffer.alloc(1024 * 1024);
    const pump = (): void => {
      while (!closed && sent < total) {
        sent += chunk.length;
        if (!socket.write(chunk)) {
          socket.once('drain', pump);
          return;
        }
      }
    };
    socket.setEncoding('latin1');
    socket.on('connect', () => {
      socket.write(`POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/x-protobuf\r\nContent-Length: ${String(total)}\r\n\r\n`);
      socket.write(Buffer.alloc(1024));
      sent = 1024;
    });
    socket.on('data', (text: string) => {
      const was = head.includes('\r\n\r\n');
      head += text;
      if (!was && head.includes('\r\n\r\n')) pump();
    });
    socket.on('close', () => {
      closed = true;
      resolve({ head, sent });
    });
    socket.on('error', () => undefined);
  });
}

describe('metrics_text', () => {
  it('sums each sample name and label set, puts families in byte order of name, samples in byte order of label text and then of sample name', () => {
    const report = (count: number): MetricFamily[] => [
      { name: 'zeta', type: 'gauge', samples: [{ name: 'zeta', labels: {}, value: 1 }] },
      {
        name: 'alpha_ms',
        type: 'histogram',
        samples: [
          { name: 'alpha_ms_count', labels: {}, value: count },
          { name: 'alpha_ms_sum', labels: {}, value: 10 },
          { name: 'alpha_ms_bucket', labels: { le: '+Inf' }, value: count },
          { name: 'alpha_ms_bucket', labels: { le: '10' }, value: 1 },
        ],
      },
    ];
    expect(metrics_text([...report(2), ...report(3)])).toBe(
      ['# TYPE alpha_ms histogram', 'alpha_ms_count 5', 'alpha_ms_sum 20', 'alpha_ms_bucket{le="+Inf"} 5', 'alpha_ms_bucket{le="10"} 2', '# TYPE zeta gauge', 'zeta 2', ''].join('\n'),
    );
  });
});

describe('server process', () => {
  it('returns two ports with --port 0 and --ops-port 0, answers GET /health/live on ops_port, and puts port into the deletion page address of BANNED', async () => {
    const made = await game('sqlite');
    const { port, ops_port } = await run_process(made, { port: 0, ops_port: 0 });
    expect(ops_port).not.toBeNull();
    expect(port).not.toBe(ops_port);
    expect(await get(ops_port as number, '/health/live')).toMatchObject({ status: 200, text: 'live' });
    const session = await testing.login(await remote(made, port), 'process_ban');
    const ban = await fetch(`http://127.0.0.1:${String(port)}/admin/ban_user`, {
      method: 'POST',
      headers: { Authorization: `Bearer ogw.${made.input.secrets.file['adminSecret.ogw'] ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: session.user_id.toString(), until_at: '0', reason: 'test' }),
    });
    expect(ban.status).toBe(200);
    const banned = await testing.send(session, 'core/Resync', resync());
    expect(error_code(banned)).toBe(E.CORE_ERROR_BANNED);
    expect(banned.envelope.error?.ban?.deletion_url).toContain(`:${String(port)}/`);
  }, TEST_MS);

  it('answers the ops paths on --ops-port and not on --port, with no request log, and ready once every server instance reported', async () => {
    const made = await game('sqlite', { 'routing.opsReportIntervalMs': 100, 'routing.readyMaxReportAgeMs': 300 });
    const { process: running, port, ops_port } = await run_process(made, { port: 0, ops_port: 0 });
    const ops = ops_port as number;
    await until(async () => (await get(ops, '/health/ready')).status === 200);
    expect(await get(ops, '/health/ready')).toMatchObject({ status: 200, text: 'ready', type: 'text/plain; charset=utf-8' });
    expect(await get(ops, '/health/live')).toMatchObject({ status: 200, text: 'live', type: 'text/plain; charset=utf-8' });
    const metrics = await get(ops, '/metrics');
    expect(metrics).toMatchObject({ status: 200, type: 'text/plain; version=0.0.4; charset=utf-8' });
    expect(sample(metrics.text, 'ogw_request_workers')).toBe(2);
    expect(sample(metrics.text, 'ogw_server_instances_ready')).toBe(2);
    expect((await get(ops, '/no/such/path')).status).toBe(404);
    const request_lines = (): number => running.lines().filter((line) => line.kind === 'request').length;
    const before = request_lines();
    for (const path of ['/health/live', '/health/ready', '/metrics']) expect((await get(port, path)).status).toBe(404);
    for (const path of ['/health/live', '/health/ready', '/metrics']) await get(ops, path);
    await real_delay(200n);
    expect(request_lines()).toBe(before);
  }, TEST_MS);

  it('sums ogw_requests_total of the request workers in GET /metrics, with a # TYPE line per family and no user ID or IP', async () => {
    const made = await game('sqlite', { 'routing.opsReportIntervalMs': 100, 'routing.readyMaxReportAgeMs': 300 });
    const { port, ops_port } = await run_process(made, { port: 0, ops_port: 0 });
    const server = await remote(made, port);
    const sessions = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => testing.login(server, `process_metrics_${String(i)}`)));
    // Requests sent together go to both request workers: the one with fewer requests in progress takes the next.
    const answered = await Promise.all(sessions.map((session) => testing.send(session, 'core/Resync', resync())));
    expect(answered.map(error_code)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const resync_total = async (): Promise<number | null> => sample((await get(ops_port as number, '/metrics')).text, 'ogw_requests_total', '{error_code="0",request="core/Resync"}');
    await until(async () => (await resync_total()) === 7);
    const text = (await get(ops_port as number, '/metrics')).text;
    const families = new Set(text.split('\n').filter((l) => l !== '' && !l.startsWith('#')).map((l) => (/^[a-z_]+/.exec(l)?.[0] ?? '').replace(/_(bucket|sum|count)$/, '')));
    for (const family of families) expect(text).toMatch(new RegExp(`^# TYPE ${family}(_seconds)? `, 'm'));
    for (const session of sessions) expect(text).not.toContain(session.user_id.toString());
    expect(text).not.toContain('127.0.0.1');
  }, TEST_MS);

  it('with --matchmaker has a realtime worker that GET /realtime reaches, and request workers that handle every game request', async () => {
    const made = await game('sqlite');
    const { process: running, port, ops_port } = await run_process(made, { port: 0, ops_port: 0, matchmaker: true });
    expect(sample((await get(ops_port as number, '/metrics')).text, 'ogw_request_workers')).toBe(2);
    const server = await remote(made, port);
    const sessions = await Promise.all([1, 2, 3, 4].map((i) => testing.login(server, `process_realtime_${String(i)}`)));
    const answered = await Promise.all(sessions.map((session) => testing.send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest())));
    expect(answered.map(error_code)).toEqual([0, 0, 0, 0]);
    // A worker thread's stdout reaches the process's stdout after its answer.
    await until(() => running.lines().filter((l) => l.probe === 'RunCoreTest').length >= 4);
    const probes = running.lines().filter((l) => l.probe === 'RunCoreTest');
    expect(probes).toHaveLength(4);
    expect(probes.every((l) => l.matchmaker === false)).toBe(true);
    // The realtime worker answers the upgrade (here without a ticket); a request worker answers it with HTTP 404.
    expect(await realtime_upgrade(port)).toMatch(/^HTTP\/1\.1 /);
    expect(await realtime_upgrade(port)).not.toMatch(/^HTTP\/1\.1 404 /);
    const without = await game('sqlite');
    const plain = await run_process(without, { port: 0 });
    expect(await realtime_upgrade(plain.port)).toMatch(/^HTTP\/1\.1 404 /);
  }, TEST_MS);

  it('closes the connection after the answer to an upgrade it does not take over while the client keeps its side open, so the request is not in progress after it', async () => {
    const made = await game('sqlite');
    const { port, ops_port } = await run_process(made, { port: 0, ops_port: 0 });
    const ops = ops_port as number;
    const in_progress = async (): Promise<number | null> => sample((await get(ops, '/metrics')).text, 'ogw_requests_in_progress');
    // `GET /realtime` gets HTTP 404 from the route on a request worker; a path without a route gets it from the path table.
    const clients = [held_upgrade(port, '/realtime'), held_upgrade(port, '/realtime'), held_upgrade(port, '/no/such/path')];
    try {
      await until(() => clients.every((c) => c.ended()));
      for (const client of clients) expect(client.text()).toMatch(/^HTTP\/1\.1 404 [^]*\r\nConnection: close\r\n\r\n$/);
      await until(async () => (await in_progress()) === 0);
      await until(() => clients.every((c) => c.closed()));
    } finally {
      for (const client of clients) client.destroy();
    }
    // The realtime worker: an upgrade it refuses before the handshake gets its whole answer, and its connection closes.
    const realtime = await game('sqlite');
    const matching = await run_process(realtime, { port: 0, matchmaker: true });
    const refused = held_upgrade(matching.port, '/realtime', false);
    try {
      await until(() => refused.ended());
      expect(refused.text()).toBe('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      await until(() => refused.closed());
    } finally {
      refused.destroy();
    }
  }, TEST_MS);

  it('closes the connection after an answer that came before the end of the body, and stops reading that body', async () => {
    const made = await game('sqlite');
    const { port } = await run_process(made, { port: 0 });
    const total = 1024 * 1024 * 1024;
    const { head, sent } = await stream_body(port, '/no/such/path', total);
    expect(head).toMatch(/^HTTP\/1\.1 404 /);
    expect(head).toMatch(/\r\nConnection: close\r\n/i);
    expect(sent).toBeLessThan(total);
    // A request whose body was read to its end keeps its connection.
    const server = await remote(made, port);
    const session = await testing.login(server, 'process_body_stream');
    expect(error_code(await testing.send(session, 'core/Resync', resync()))).toBe(0);
  }, TEST_MS);

  it('returns the reason when a server instance fails server start, writes one error log line with it, accepts no connection after, and the entry point ends with exit code 1', async () => {
    const made = await game('sqlite');
    const port = await free_port();
    const bad_secret_file = `${made.server}/bad-secrets.json`;
    writeFileSync(bad_secret_file, '{}');
    const running = keep(start_point(made, ['--env', 'LOCAL', '--port', String(port), '--db', made.input.database.db_argument, '--secret-file', bad_secret_file]));
    expect(await running.exited).toBe(1);
    const front_lines = running.lines().filter((l) => l.kind === 'error' && typeof l.message === 'string' && /^(request|realtime) worker/.test(l.message));
    expect(front_lines).toHaveLength(1);
    expect(await accepts(port)).toBe(false);

    const failed = await driver(made, { port: 0, secret_file: bad_secret_file });
    keep(failed.process);
    expect(typeof failed.output).toBe('string');
    expect(failed.output as string).toContain('request worker');
  }, TEST_MS);

  it('fails start when --ops-port is a port another socket holds: one error log line, no connection on --port, exit code 1', async () => {
    const made = await game('sqlite');
    const holder = createServer();
    const held = await new Promise<number>((resolve) => {
      holder.listen(0, () => {
        resolve((holder.address() as { port: number }).port);
      });
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          holder.close(() => {
            resolve();
          });
        }),
    );
    const port = await free_port();
    const running = keep(start_point(made, local_args(made, ['--port', String(port), '--ops-port', String(held)])));
    expect(await running.exited).toBe(1);
    const errors = running.lines().filter((l) => l.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.message)).toContain('--ops-port');
    expect(await accepts(port)).toBe(false);
  }, TEST_MS);

  it('runs the settings check on server/generated/core_settings.json before any worker starts, and returns its reason with one error log line on failure', async () => {
    const made = await game('sqlite', { 'routing.requestWorkers': 0, 'routing.readyMaxReportAgeMs': 'soon' });
    const port = await free_port();
    const running = keep(start_point(made, local_args(made, ['--port', String(port)])));
    expect(await running.exited).toBe(1);
    const lines = running.lines();
    const errors = lines.filter((l) => l.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.message)).toBe('settings check failed: routing.readyMaxReportAgeMs (type), routing.requestWorkers (minimum)');
    expect(lines.filter((l) => l.kind !== undefined || l.probe !== undefined)).toHaveLength(1);
    expect(await accepts(port)).toBe(false);

    const failed = await driver(made, { port: 0 });
    keep(failed.process);
    expect(failed.output).toBe('settings check failed: routing.readyMaxReportAgeMs (type), routing.requestWorkers (minimum)');
  }, TEST_MS);

  it('ends with exit code 1 and one error log line naming the thread when the thread of a request worker ends while the process runs', async () => {
    const made = await game('sqlite');
    const port = await free_port();
    const running = keep(start_point(made, local_args(made, ['--port', String(port)]), { OGW_TEST_MODE: 'exit' }));
    await until(() => accepts(port));
    const session = await testing.login(await remote(made, port), 'process_exit');
    await testing.send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest()).catch(() => null);
    expect(await running.exited).toBe(1);
    const named = running.lines().filter((l) => l.kind === 'error' && String(l.message).includes('request worker 1') && String(l.message).includes('exit code 7'));
    expect(named).toHaveLength(1);
  }, TEST_MS);

  it('accepts no new connection after SIGTERM, stops every server instance and ends', async () => {
    const made = await game('sqlite');
    const { process: running, port, ops_port } = await run_process(made, { port: 0, ops_port: 0 });
    expect((await get(ops_port as number, '/health/live')).status).toBe(200);
    running.child.kill('SIGTERM');
    expect(await running.exited).toBe(0);
    expect(await accepts(port)).toBe(false);
    expect(await accepts(ops_port as number)).toBe(false);
  }, TEST_MS);
});

describe.skipIf(PG === null)('server process on PostgreSQL', () => {
  /** The `game_state` row `CoreTestGameState` key 1, made by a `RunCoreTest` of `OGW_TEST_MODE` `lock`. */
  const ROW = "SELECT \"key\" FROM game_state WHERE kind = 'core_test_game_state' AND \"key\" = 1 FOR UPDATE";

  it('hands the requests that arrive while a request worker waits in a DB call to the other request worker', async () => {
    const made = await game('postgresql', { 'routing.requestWorkers': 2, 'storage.userLockWaitMs': 20_000 });
    const port = await free_port();
    const ops = await free_port();
    keep(start_point(made, local_args(made, ['--port', String(port), '--ops-port', String(ops)]), { OGW_TEST_MODE: 'lock' }));
    await until(async () => (await accepts(port)) && (await accepts(ops)) && (await get(ops, '/health/live')).status === 200, 60_000);
    const server = await remote(made, port);
    const blocker = await testing.login(server, 'process_pg_blocker');
    const others = [];
    for (let i = 0; i < 10; i += 1) others.push(await testing.login(server, `process_pg_${String(i)}`));
    expect(error_code(await testing.send(blocker, 'RunCoreTest', new GameContract.RunCoreTestRequest()))).toBe(0);
    const connection = made.input.database.connection as string;
    const holder = await testing.hold_db(connection, [{ sql: ROW }]);
    let held = true;
    try {
      const blocked = testing.send(blocker, 'RunCoreTest', new GameContract.RunCoreTestRequest());
      const db_waiting = async (): Promise<number | null> => sample((await get(ops, '/metrics')).text, 'ogw_request_workers_db_waiting');
      await until(async () => (await db_waiting()) === 1);
      for (const session of others) {
        const answered = await testing.send(session, 'core/Resync', resync());
        expect(error_code(answered)).toBe(0);
        expect(held).toBe(true);
      }
      expect(await db_waiting()).toBe(1);
      await holder.release();
      held = false;
      expect(error_code(await blocked)).toBe(0);
    } finally {
      if (held) await holder.release();
    }
  }, TEST_MS);

  it('is not ready while the DB probe fails or a report is older than routing.readyMaxReportAgeMs, and answers live and metrics while every request worker waits in a DB call', async () => {
    const made = await game('postgresql', { 'routing.requestWorkers': 2, 'storage.userLockWaitMs': 20_000, 'routing.opsReportIntervalMs': 100, 'routing.readyMaxReportAgeMs': 400 });
    const { port, ops_port } = await run_process(made, { port: 0, ops_port: 0 }, { OGW_TEST_MODE: 'lock' });
    const ops = ops_port as number;
    const ready = async (): Promise<number> => (await get(ops, '/health/ready')).status;
    await until(async () => (await ready()) === 200);
    const server = await remote(made, port);
    const first = await testing.login(server, 'process_ready_1');
    const second = await testing.login(server, 'process_ready_2');
    expect(error_code(await testing.send(first, 'RunCoreTest', new GameContract.RunCoreTestRequest()))).toBe(0);
    const holder = await testing.hold_db(made.input.database.connection as string, [{ sql: ROW }]);
    let held = true;
    try {
      const blocked = [testing.send(first, 'RunCoreTest', new GameContract.RunCoreTestRequest()), testing.send(second, 'RunCoreTest', new GameContract.RunCoreTestRequest())];
      await until(async () => sample((await get(ops, '/metrics')).text, 'ogw_request_workers_db_waiting') === 2);
      expect((await get(ops, '/health/live')).status).toBe(200);
      expect((await get(ops, '/metrics')).status).toBe(200);
      // No report comes while the threads wait: the last ones grow older than routing.readyMaxReportAgeMs.
      await until(async () => (await ready()) === 503);
      await holder.release();
      held = false;
      for (const answer of await Promise.all(blocked)) expect(error_code(answer)).toBe(0);
      await until(async () => (await ready()) === 200);
    } finally {
      if (held) await holder.release();
    }
    // The DB probe fails while the database takes no connection.
    const admin = await open_pg_session(PG as string);
    const name = made.input.database.name;
    try {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`, []);
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
      await until(async () => (await ready()) === 503);
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`, []);
      await until(async () => (await ready()) === 200);
    } finally {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`, []).catch(() => null);
      admin.close();
    }
  }, TEST_MS);
});
