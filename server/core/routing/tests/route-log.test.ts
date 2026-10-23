import { setTimeout as real_wait } from 'node:timers/promises';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { close, connect, type RealtimeConnection } from '../../testing/dev/index.ts';
import type { RouteRequest } from '../module_api.ts';
import { game_register, logs, new_calls, raw, start, stop, type ContentCore, type TestServer } from './support.ts';

vi.mock('../../../generated/contract/game_contract.ts', async (import_original) => (await import('./game_contract_mock.ts')).mock_game_contract(await import_original()));

/** What the `GET /realtime` route of `matchmaker` does in these tests before (or instead of) its own handling. */
type Mode = 'none' | 'throw' | 'security';

const probe = globalThis as { routing_route_mode?: Mode; routing_route_security?: (reason: string) => void };

// `matchmaker` whose `GET /realtime` route throws, or first writes a `security` line without ip, as `routing_route_mode` says.
vi.mock('../../matchmaker/index.ts', async (import_original) => {
  const original = await import_original<typeof import('../../matchmaker/index.ts')>();
  return {
    ...original,
    create_matchmaker: (input: Parameters<typeof original.create_matchmaker>[0]) => {
      const module = original.create_matchmaker(input);
      const route = module['GET /realtime'].bind(module);
      return Object.assign(module, {
        'GET /realtime': (request: RouteRequest, ip: string) => {
          const mode = probe.routing_route_mode ?? 'none';
          if (mode === 'throw') throw new Error('routing probe route failure');
          if (mode === 'security') probe.routing_route_security?.('routing_probe_upgrade');
          return route(request, ip);
        },
      });
    },
  };
});

const servers: TestServer[] = [];
const connections: RealtimeConnection[] = [];

afterEach(async () => {
  probe.routing_route_mode = 'none';
  probe.routing_route_security = undefined;
  for (const connection of connections.splice(0)) close(connection);
  for (const server of servers.splice(0)) await stop(server);
});

/** A test server with `--matchmaker`, so `GET /realtime` is a route; its register sets `routing_route_security`. */
async function started(): Promise<TestServer> {
  const server = await start({
    matchmaker: true,
    register: game_register(new_calls(), (core: ContentCore) => {
      const logging = (core as unknown as { logging: { write(entry: Record<string, unknown>): void } }).logging;
      probe.routing_route_security = (reason) => {
        logging.write({ kind: 'security', level: 'warn', message: reason, user_id: null, request_id: null, request: null, fields: { reason } });
      };
    }),
  });
  servers.push(server);
  return server;
}

/** The `request` lines of routes (no request name) written after the first `before` lines. */
function route_lines(server: TestServer, before: number): Record<string, unknown>[] {
  return logs(server, 'request').slice(before).filter((line) => line.request === null);
}

/** The route lines after `before`, once `count` of them are written (the line follows the route's answer), in real time. */
async function wait_route_lines(server: TestServer, before: number, count: number): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < 100 && route_lines(server, before).length < count; i += 1) await real_wait(20);
  return route_lines(server, before);
}

/** Opens `/realtime` with a WebSocket upgrade; false when the server closed the connection instead. */
async function open_realtime(server: TestServer): Promise<boolean> {
  try {
    connections.push(await connect(server as unknown as Parameters<typeof connect>[0]));
    return true;
  } catch {
    return false;
  }
}

describe('request logs of routes', () => {
  it('writes one request log for a WebSocket upgrade of GET /realtime', async () => {
    const server = await started();
    const before = logs(server, 'request').length;
    expect(await open_realtime(server)).toBe(true);
    const lines = await wait_route_lines(server, before, 1);
    // A later line would be a second line of the same upgrade.
    await real_wait(100);
    expect(route_lines(server, before)).toHaveLength(1);
    expect(lines[0]?.error_code).toBe(0);
  });

  it('writes one request log with error_code INTERNAL when a route handler throws, for an HTTP request and a WebSocket upgrade', async () => {
    const server = await started();
    probe.routing_route_mode = 'throw';
    let before = logs(server, 'request').length;
    expect((await raw(server, 'GET', '/realtime', {})).status).toBe(500);
    const http_lines = await wait_route_lines(server, before, 1);
    expect(http_lines.map((line) => line.error_code)).toEqual([CoreContract.CoreError.CORE_ERROR_INTERNAL]);
    expect(logs(server, 'error').filter((line) => line.message === 'route GET /realtime failed')).toHaveLength(1);
    before = logs(server, 'request').length;
    expect(await open_realtime(server)).toBe(false);
    const upgrade_lines = await wait_route_lines(server, before, 1);
    await real_wait(100);
    expect(route_lines(server, before)).toHaveLength(1);
    expect(upgrade_lines.map((line) => line.error_code)).toEqual([CoreContract.CoreError.CORE_ERROR_INTERNAL]);
    expect(logs(server, 'error').filter((line) => line.message === 'route GET /realtime failed')).toHaveLength(2);
  });

  it('gives a security log line without ip, written by the route of a WebSocket upgrade, the truncated client IP', async () => {
    const server = await started();
    probe.routing_route_mode = 'security';
    expect(await open_realtime(server)).toBe(true);
    probe.routing_route_mode = 'none';
    probe.routing_route_security?.('routing_probe_outside');
    const lines = logs(server, 'security').filter((line) => String(line.reason).startsWith('routing_probe_'));
    // LOCAL: the client IP is the TCP peer address 127.0.0.1.
    expect(lines.map((line) => [line.reason, line.ip])).toEqual([
      ['routing_probe_upgrade', '127.0.0.0'],
      ['routing_probe_outside', null],
    ]);
  });
});
