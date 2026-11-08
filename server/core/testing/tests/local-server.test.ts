import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { make_purpose_seed } from '../../storage/random.ts';
import { connect_server, default_db_kind, login, send, type TestSession } from '../dev/index.ts';
import { check_seed_provider } from '../dev/local_server.ts';
import { free_port, local_args, local_game, run_local, wait_listening, type LocalGame, type LocalProcess } from './local_support.ts';

/** A process test starts `node` processes that build a server instance of every module: a long real time limit. */
const PROCESS_TEST_MS = 180_000;

/** The `seed` of each `request` log line of a request ID, in log order. */
function seeds_of(proc: LocalProcess, request_id: string): unknown[] {
  return proc.lines().filter((line) => line.kind === 'request' && line.request_id === request_id).map((line) => line.seed);
}

/** Waits for the `request` log line of the `n`-th answer (from 1) of a request ID, then gives its `seed`. */
async function seed_of(proc: LocalProcess, request_id: string, n = 1): Promise<unknown> {
  await proc.wait_line(() => seeds_of(proc, request_id).length >= n);
  return seeds_of(proc, request_id)[n - 1];
}

const expected = (base: bigint): string => make_purpose_seed('RunCoreTest', base).toString();

/** A running local server of a game folder, and the remote test server that sends to it. */
interface Local {
  readonly game: LocalGame;
  readonly proc: LocalProcess;
  readonly port: number;
  /** The HTTP status of the first `GET /update/deploy_list.json` it answered. */
  readonly deploy_list_status: number;
  login(name: string): Promise<TestSession>;
}

const running: Local[] = [];

async function start_local(random_base: bigint, settings: Readonly<Record<string, unknown>> = {}, env: Readonly<Record<string, string>> = {}): Promise<Local> {
  const game = await local_game(default_db_kind(), settings);
  const port = await free_port();
  const proc = run_local(game, local_args(game, port), random_base, env);
  running.push({ game, proc, port, deploy_list_status: 0, login: () => Promise.reject(new Error('not listening')) });
  const deploy_list_status = await wait_listening(proc, port);
  const local: Local = {
    game,
    proc,
    port,
    deploy_list_status,
    login: async (name) => login(await connect_server(`http://127.0.0.1:${String(port)}`, game.input.data_folder, game.input.secrets.dev_access), name),
  };
  return local;
}

function run_core_test(session: TestSession, request_id: string): ReturnType<typeof send> {
  return send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest(), request_id);
}

afterEach(async () => {
  for (const local of running.splice(0)) {
    await local.proc.kill();
    await local.game.remove();
  }
});

describe('start_local_server', () => {
  it(
    'two processes with random base 7 give the first and second RunCoreTest of a user the same seeds, whatever other users and request names send between them',
    async () => {
      const [a, b] = await Promise.all([start_local(7n), start_local(7n)]);
      const [user_a, user_b, other] = await Promise.all([a.login('seed_user'), b.login('seed_user'), a.login('other_user')]);
      const first = [randomUUID(), randomUUID()];
      const second = [randomUUID(), randomUUID()];
      expect((await run_core_test(user_a, first[0] ?? '')).envelope.error).toBeNull();
      expect((await run_core_test(user_b, first[1] ?? '')).envelope.error).toBeNull();
      // Only on a: another user's RunCoreTest, and requests of another request name, in between.
      expect((await run_core_test(other, randomUUID())).envelope.error).toBeNull();
      expect((await send(other, 'core/Resync', new CoreContract.ResyncRequest())).envelope.error).toBeNull();
      expect((await send(user_a, 'core/Resync', new CoreContract.ResyncRequest())).envelope.error).toBeNull();
      expect((await run_core_test(user_a, second[0] ?? '')).envelope.error).toBeNull();
      expect((await run_core_test(user_b, second[1] ?? '')).envelope.error).toBeNull();
      expect(await seed_of(a.proc, first[0] ?? '')).toBe(expected(7n));
      expect(await seed_of(b.proc, first[1] ?? '')).toBe(expected(7n));
      expect(await seed_of(a.proc, second[0] ?? '')).toBe(expected(8n));
      expect(await seed_of(b.proc, second[1] ?? '')).toBe(expected(8n));
    },
    PROCESS_TEST_MS,
  );

  it(
    'a resend of a RunCoreTest rolled back with INTERNAL gets its first seed again, and the next RunCoreTest the next one',
    async () => {
      const local = await start_local(7n, {}, { OGW_TEST_FAIL_FIRST: '1' });
      const session = await local.login('resend_user');
      const failed = randomUUID();
      expect((await run_core_test(session, failed)).envelope.error?.code).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
      expect((await run_core_test(session, failed)).envelope.error).toBeNull();
      const next = randomUUID();
      expect((await run_core_test(session, next)).envelope.error).toBeNull();
      expect(await seed_of(local.proc, failed, 2)).toBe(expected(7n));
      expect(await seed_of(local.proc, next)).toBe(expected(8n));
    },
    PROCESS_TEST_MS,
  );

  it(
    'a resend of a committed RunCoreTest has seed null and leaves the next RunCoreTest at base + 1',
    async () => {
      const local = await start_local(7n);
      const session = await local.login('committed_user');
      const first = randomUUID();
      expect((await run_core_test(session, first)).envelope.error).toBeNull();
      expect((await run_core_test(session, first)).envelope.error).toBeNull();
      const next = randomUUID();
      expect((await run_core_test(session, next)).envelope.error).toBeNull();
      expect(await seed_of(local.proc, first)).toBe(expected(7n));
      expect(await seed_of(local.proc, first, 2)).toBeNull();
      expect(await seed_of(local.proc, next)).toBe(expected(8n));
    },
    PROCESS_TEST_MS,
  );

  it(
    'with random base 8 the first RunCoreTest of a user gets base 8, and 2 request workers of routing give the same seeds as 1',
    async () => {
      const [eight, one, two] = await Promise.all([start_local(8n), start_local(7n, { 'routing.requestWorkers': 1 }), start_local(7n, { 'routing.requestWorkers': 2 })]);
      const id = randomUUID();
      expect((await run_core_test(await eight.login('base_user'), id)).envelope.error).toBeNull();
      expect(await seed_of(eight.proc, id)).toBe(expected(8n));
      for (const local of [one, two]) {
        const session = await local.login('workers_user');
        const ids = [randomUUID(), randomUUID()];
        for (const request_id of ids) expect((await run_core_test(session, request_id)).envelope.error).toBeNull();
        expect([await seed_of(local.proc, ids[0] ?? ''), await seed_of(local.proc, ids[1] ?? '')]).toEqual([expected(7n), expected(8n)]);
      }
    },
    PROCESS_TEST_MS,
  );

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'a LOCAL server answers GET /update/deploy_list.json and its process ends after %s',
    async (signal) => {
      const local = await start_local(7n);
      // A new DB holds no deploy list: `game-update` answers HTTP 404 (`## API` of `game-update`).
      expect(local.deploy_list_status).toBe(404);
      local.proc.child.kill(signal);
      expect(await local.proc.exited).toBe(0);
      expect(local.proc.lines().some((line) => line.driver === 'stopped')).toBe(true);
      await expect(fetch(`http://127.0.0.1:${String(local.port)}/update/deploy_list.json`)).rejects.toThrow();
    },
    PROCESS_TEST_MS,
  );

  /**
   * Runs the driver in a LOCAL game folder with a new DB, with the server start arguments `args` of `port`, and waits
   * for its failure line and its exit. Every other start input is valid, so only the checked argument can fail it.
   */
  async function start_failure(args: (game: LocalGame, port: number) => string[], settings: Readonly<Record<string, unknown>> = {}): Promise<{ line: Record<string, unknown>; port: number }> {
    const game = await local_game(default_db_kind(), settings);
    const port = await free_port();
    const proc = run_local(game, args(game, port), 7n);
    running.push({ game, proc, port, deploy_list_status: 0, login: () => Promise.reject(new Error('not listening')) });
    const line = await proc.wait_line((l) => l.driver !== undefined);
    expect(await proc.exited).toBe(1);
    expect(line.driver).toBe('failed');
    expect(line.name).toBe('StartFailure');
    return { line, port };
  }

  async function answers(port: number): Promise<boolean> {
    return fetch(`http://127.0.0.1:${String(port)}/update/deploy_list.json`).then(
      async (reply) => {
        await reply.arrayBuffer();
        return true;
      },
      () => false,
    );
  }

  it.each([
    ['--env DEV', (_game: LocalGame, port: number): string[] => ['--env', 'DEV', '--port', String(port)], 'takes only --env LOCAL, not --env DEV'],
    ['--ops-port', (game: LocalGame, port: number): string[] => [...local_args(game, port), '--ops-port', String(port + 1)], 'takes no --ops-port'],
  ])(
    'with %s, in a game folder whose other start inputs are valid, throws StartFailure of that rule and listens on no port',
    async (_name, args, rule) => {
      const { line, port } = await start_failure(args);
      expect(String(line.message)).toContain(rule);
      expect(line.logs).toEqual([]);
      expect(await answers(port)).toBe(false);
    },
    PROCESS_TEST_MS,
  );

  it(
    'a server start failure (routing.requestWorkers 0 fails the settings check) throws StartFailure with the reason and its start log lines, and listens on no port',
    async () => {
      const { line, port } = await start_failure(local_args, { 'routing.requestWorkers': 0 });
      expect(String(line.message)).toContain('routing.requestWorkers (minimum)');
      const logs = line.logs as Record<string, unknown>[];
      expect(logs.filter((l) => l.kind === 'error' && String(l.message).includes('routing.requestWorkers (minimum)'))).toHaveLength(1);
      expect(await answers(port)).toBe(false);
    },
    PROCESS_TEST_MS,
  );
});

describe('check seed provider', () => {
  it('make_seed calls of match, room, match with random base 7 give match 7, room 7, match 8, and a request in between does not change them', () => {
    const provider = check_seed_provider(7n);
    expect(provider('', 0n, 'match')).toBe(make_purpose_seed('match', 7n));
    expect(provider(randomUUID(), 5n, 'match')).toBe(make_purpose_seed('match', 7n));
    expect(provider('', 0n, 'room')).toBe(make_purpose_seed('room', 7n));
    expect(provider(randomUUID(), 5n, 'match')).toBe(make_purpose_seed('match', 8n));
    expect(provider('', 0n, 'match')).toBe(make_purpose_seed('match', 8n));
  });

  it('counts request IDs per user ID and request name, gives a request ID that came before its first seed, and adds modulo 2^64', () => {
    const provider = check_seed_provider(9_223_372_036_854_775_807n);
    expect(provider('a', 1n, 'RunCoreTest')).toBe(make_purpose_seed('RunCoreTest', 9_223_372_036_854_775_807n));
    expect(provider('b', 2n, 'RunCoreTest')).toBe(make_purpose_seed('RunCoreTest', 9_223_372_036_854_775_807n));
    expect(provider('c', 1n, 'core/Resync')).toBe(make_purpose_seed('core/Resync', 9_223_372_036_854_775_807n));
    expect(provider('a', 1n, 'RunCoreTest')).toBe(make_purpose_seed('RunCoreTest', 9_223_372_036_854_775_807n));
    expect(provider('d', 1n, 'RunCoreTest')).toBe(make_purpose_seed('RunCoreTest', -9_223_372_036_854_775_808n));
  });
});
