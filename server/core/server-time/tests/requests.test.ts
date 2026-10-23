/**
 * `server-time` through a test server: a target violation in a request handler, and the user counter window of a
 * user with a cheat time offset, as `routing`, `storage` and `cheat` run them.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import type { ServerTimeApi } from '../index.ts';

type TestServer = Awaited<ReturnType<typeof testing.start_test_server>>;
type TestSession = Awaited<ReturnType<typeof testing.login>>;

const E = CoreContract.CoreError;
const RUN = 'RunCoreTest';
const MINUTE = 60_000n;
/** A minute window start. */
const WINDOW = 1_800_000_000_000n;
/** 30 s into the minute window `WINDOW`. */
const START_AT = WINDOW + 30_000n;

/** What a `RunCoreTest` handler runs in the request's ctx. */
type Operation = (ctx: RequestCtx) => void;

interface Started {
  readonly server: TestServer;
  readonly session: TestSession;
  readonly storage: Storage;
  readonly time: ServerTimeApi;
  /** Sets what the next `RunCoreTest` handler runs. */
  set(operation: Operation | null): void;
}

const servers: TestServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await testing.stop_test_server(server);
});

interface RegisterCore {
  readonly routing: { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
  readonly storage: Storage;
  readonly 'server-time': ServerTimeApi;
}

async function start(settings: Readonly<Record<string, unknown>> = {}): Promise<Started> {
  let operation: Operation | null = null;
  let modules: RegisterCore | null = null;
  const register = (core: Readonly<Record<string, unknown>>): void => {
    const own = core as unknown as RegisterCore;
    modules = own;
    own.routing.register_handler(RUN, (ctx) => {
      operation?.(ctx);
      return new GameContract.RunCoreTestResponse();
    });
    testing.core_test_register(core, [RUN]);
  };
  const server = await testing.start_test_server(START_AT, undefined, undefined, undefined, undefined, settings, register);
  servers.push(server);
  const core = modules as RegisterCore | null;
  if (core === null) throw new Error('register did not run');
  const session = await testing.login(server, 'server_time');
  return {
    server,
    session,
    // Content `register(core)` gets only the member `content` of `storage`; the test reads rows through the module object.
    storage: storage_module(server),
    time: core['server-time'],
    set: (next) => {
      operation = next;
    },
  };
}

function run(session: TestSession): Promise<testing.SendResult> {
  return testing.send(session, RUN, new GameContract.RunCoreTestRequest());
}

function code_of(result: testing.SendResult): number {
  return result.envelope.error?.code ?? 0;
}

/** The `GuildTestUserState` `changes` the user's committed UserState holds, or null. */
async function stored_changes(server: TestServer, user_id: bigint): Promise<bigint | null> {
  const item = (await testing.read_user_state(server, user_id)).find((i) => i.kind === 'GuildTestUserState');
  return item === undefined ? null : (item.value as GameContract.GuildTestUserState).changes;
}

function write_changes(storage: Storage, ctx: RequestCtx, changes: bigint): void {
  const state = new GameContract.GuildTestUserState();
  state.changes = changes;
  storage.put_state(ctx, state);
}

function as_bigint(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' || typeof value === 'string') return BigInt(value);
  throw new Error(`not an integer: ${String(value)}`);
}

/** The user counter rows of a user as [window_start, count]. */
function user_counter_rows(s: Started): [bigint, bigint][] {
  const rows = s.storage
    .read_db()
    .query('SELECT window_start, count FROM routing_rate_counter WHERE kind = $1 AND target = $2 ORDER BY window_start', ['user', s.session.user_id.toString()]);
  return rows.map((row) => [as_bigint(row.window_start), as_bigint(row.count)]);
}

describe('target violation in a request', () => {
  it.each([
    ['is_reached', -1n],
    ['is_reached', 2n ** 63n],
    ['is_reached_strict', -1n],
    ['is_reached_strict', 2n ** 63n],
  ] as const)('ends the request INTERNAL for %s(ctx, %s) and keeps the stored state', async (operation, target) => {
    const s = await start();
    s.set((ctx) => {
      write_changes(s.storage, ctx, 1n);
    });
    expect(code_of(await run(s.session))).toBe(0);
    expect(await stored_changes(s.server, s.session.user_id)).toBe(1n);

    const errors = testing.read_logs(s.server, 'error', 'error').length;
    let reached = false;
    s.set((ctx) => {
      write_changes(s.storage, ctx, 2n);
      reached = true;
      s.time[operation](ctx, target);
    });
    const result = await run(s.session);
    expect(reached).toBe(true);
    expect(code_of(result)).toBe(E.CORE_ERROR_INTERNAL);
    expect(result.response).toBeNull();
    expect(await stored_changes(s.server, s.session.user_id)).toBe(1n);
    const lines = testing.read_logs(s.server, 'error', 'error').slice(errors);
    expect(lines.some((line) => line.request === RUN)).toBe(true);

    // The same handler with a target in range ends without an error and saves.
    s.set((ctx) => {
      write_changes(s.storage, ctx, 3n);
      s.time[operation](ctx, 0n);
    });
    expect(code_of(await run(s.session))).toBe(0);
    expect(await stored_changes(s.server, s.session.user_id)).toBe(3n);
  });
});

describe('user counter window with a cheat time offset', () => {
  it('counts in the minute window of clock_now, not of clock + offset', async () => {
    const limit = 4;
    const s = await start({ 'routing.userRateLimitPerMinute': limit });
    // clock + offset is in the next minute window.
    const offset = 45_000n;
    const set = new CoreCheatContract.SetTimeOffsetRequest();
    set.offset_ms = offset;
    expect(code_of(await testing.send_cheat(s.session, 'core/cheat/SetTimeOffset', set))).toBe(0);

    const request_times: bigint[] = [];
    s.set((ctx) => {
      request_times.push(ctx.request_time);
    });
    const codes: number[] = [];
    for (let i = 0; i < limit + 1; i += 1) codes.push(code_of(await run(s.session)));
    expect(request_times[0]).toBe(START_AT + offset);
    expect(s.time.get_window_start(MINUTE, START_AT + offset)).toBe(WINDOW + MINUTE);
    expect(s.time.clock_now()).toBe(START_AT);

    // SetTimeOffset counted in the clock window too, so fewer than `limit` RunCoreTest requests fit in it.
    const passed = codes.filter((c) => c === 0).length;
    expect(passed).toBeLessThan(limit);
    expect(codes.slice(passed).every((c) => c === E.CORE_ERROR_RATE_LIMITED)).toBe(true);
    expect(codes.slice(0, passed).every((c) => c === 0)).toBe(true);
    const rows = user_counter_rows(s);
    expect(rows.map(([window_start]) => window_start)).toEqual([WINDOW]);
    expect((rows[0] ?? [0n, 0n])[1]).toBeGreaterThan(BigInt(limit));

    // The next window of the clock takes requests again; clock + offset is still one window ahead.
    testing.advance_time(s.server, 30_000n);
    expect(code_of(await run(s.session))).toBe(0);
    expect(request_times.at(-1)).toBe(WINDOW + MINUTE + offset);
    expect(user_counter_rows(s).map(([window_start]) => window_start)).toEqual([WINDOW, WINDOW + MINUTE]);
  });
});
