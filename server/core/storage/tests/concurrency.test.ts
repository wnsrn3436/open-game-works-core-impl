import { randomUUID } from 'node:crypto';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { login, send, start_peer_process, start_peer_server, start_test_server, stop_peer_processes, stop_test_server, type TestServer, type TestSession } from '../../testing/dev/index.ts';
import type { RemoteServer } from '../../testing/dev/index.ts';
import { counter_register, read_before, refused } from './counter_register.ts';

const PEER = { module: new URL('./counter_register.ts', import.meta.url), name: 'counter_peer' };

/** The requests of one test wait for the user lock and the row lock behind all the others; none waits past this. */
const WAIT = { 'storage.userLockWaitMs': 20_000 };

/** Time limit of one test: peers start and every request waits for the counter row in turn. */
const T = 120_000;

const REFUSED = GameContract.GameError.GAME_ERROR_CORE_TEST;

afterEach(stop_peer_processes);

/** A request ID that `refused` does not refuse. */
function accepted_request_id(): string {
  for (;;) {
    const id = randomUUID();
    if (!refused(id)) return id;
  }
}

interface Sent {
  readonly request_id: string;
  readonly code: number;
}

/** Sends `RunCoreTest` as the session to `server` (the server the request reaches, not the one it logged in to). */
async function hit(session: TestSession, server: TestServer | RemoteServer, request_id: string = randomUUID()): Promise<Sent> {
  const { envelope } = await send({ ...session, server }, 'RunCoreTest', new GameContract.RunCoreTestRequest(), request_id);
  return { request_id, code: envelope.error?.code ?? 0 };
}

/**
 * Checks the outcome of the concurrent counter requests: each ends with a response, or with `GAME_ERROR_CORE_TEST`
 * exactly when `refused` refuses its request ID. A later request through `server` reads the number of accepted ones.
 */
async function expect_counted(results: readonly Sent[], session: TestSession, server: TestServer): Promise<number> {
  for (const r of results) expect(r.code, r.request_id).toBe(refused(r.request_id) ? REFUSED : 0);
  const accepted = results.filter((r) => r.code === 0).length;
  expect(accepted).toBeGreaterThan(0);
  expect(accepted).toBeLessThan(results.length);
  const last = await hit(session, server, accepted_request_id());
  expect(last.code).toBe(0);
  expect(read_before.get(last.request_id)).toBe(BigInt(accepted));
  return accepted;
}

describe('concurrent read-modify-write of one game_state row under lock_game_row (PostgreSQL)', () => {
  it('60 requests of 6 users at once through a test server and its two peers: no update is lost, and the counter is the number of accepted requests', async () => {
    read_before.clear();
    const server = await start_test_server(undefined, 'postgresql', undefined, undefined, undefined, WAIT, counter_register);
    try {
      const instances: TestServer[] = [server, await start_peer_server(server), await start_peer_server(server)];
      const sessions = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => login(server, `counter_user_${String(i)}`)));
      const results = await Promise.all(
        sessions.flatMap((session, i) => Array.from({ length: 10 }, (_, j) => hit(session, instances[(i + j) % instances.length] as TestServer))),
      );
      expect(results).toHaveLength(60);
      const accepted = await expect_counted(results, sessions[0] as TestSession, server);
      // Each accepted request read the count of the accepted requests before it under the row lock.
      const reads = results.filter((r) => r.code === 0).map((r) => read_before.get(r.request_id) ?? -1n);
      expect([...reads].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(Array.from({ length: accepted }, (_, n) => BigInt(n)));
    } finally {
      await stop_test_server(server);
    }
  }, T);

  it('64 requests of 8 users at once through a test server and a peer process on the same database: no update is lost, and the counter is the number of accepted requests', async () => {
    read_before.clear();
    const server = await start_test_server(undefined, 'postgresql', undefined, undefined, undefined, WAIT, counter_register);
    try {
      const peer = await start_peer_process(server, PEER);
      const local = await Promise.all([0, 1, 2, 3].map((i) => login(server, `counter_local_${String(i)}`)));
      const remote = await Promise.all([0, 1, 2, 3].map((i) => login(peer.remote, `counter_remote_${String(i)}`)));
      const results = await Promise.all([
        ...local.flatMap((session) => Array.from({ length: 8 }, () => hit(session, server))),
        ...remote.flatMap((session) => Array.from({ length: 8 }, () => hit(session, peer.remote))),
      ]);
      expect(results).toHaveLength(64);
      const accepted = await expect_counted(results, local[0] as TestSession, server);
      // The accepted requests of this process read distinct counts below the total.
      const reads = results.slice(0, 32).filter((r) => r.code === 0).map((r) => read_before.get(r.request_id) ?? -1n);
      expect(new Set(reads).size).toBe(reads.length);
      for (const n of reads) expect(n >= 0n && n < BigInt(accepted)).toBe(true);
    } finally {
      await stop_peer_processes();
      await stop_test_server(server);
    }
  }, T);
});
