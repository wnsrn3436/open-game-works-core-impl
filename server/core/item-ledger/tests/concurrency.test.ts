import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { login, read_user_state, send, start_peer_process, start_peer_server, start_test_server, stop_peer_processes, stop_test_server } from '../../testing/dev/index.ts';
import type { RemoteServer, TestServer } from '../../testing/dev/index.ts';
import { id } from './helpers.ts';
import { delta_of, GRANT, ledger_register, read_seen_note, seen, seen_gate, SPEND } from './ledger_register.ts';
import type { Seen } from './ledger_register.ts';

const PEER = { module: new URL('./ledger_register.ts', import.meta.url), name: 'ledger_peer' };

/** The requests of the test wait for the user lock behind all the others; none waits past this. */
const WAIT = { 'storage.userLockWaitMs': 20_000 };

/** Time limit of the test: peers start and every request waits for the user in turn. */
const T = 120_000;

const REFUSED = GameContract.GameError.GAME_ERROR_CORE_TEST;

afterEach(stop_peer_processes);

/** A new request ID whose `delta_of` is `delta`. */
function request_id_of(delta: bigint): string {
  for (;;) {
    const request_id = randomUUID();
    if (delta_of(request_id) === delta) return request_id;
  }
}

/** The `[gold]` balance in the response's UserState delta (a deleted row is 0), or null when the delta has none. */
function balance_in(envelope: CoreContract.ResponseEnvelope, gold: bigint): bigint | null {
  const entry = (envelope.user_state?.entries ?? []).find((e) => e.kind === 'ItemBalanceUserState' && e.id === gold);
  if (entry === undefined) return null;
  return entry.deleted ? 0n : (CoreContract.ItemBalanceUserState.decode(entry.value)?.amount ?? null);
}

describe('concurrent item changes of one user (PostgreSQL)', () => {
  it('60 grants and spends of one user at once through a test server, a peer and a peer process: the balance is the sum of the accepted changes, no spend makes it negative, and each request ends with a response or NOT_ENOUGH', async () => {
    seen.clear();
    const gold = BigInt(id('[gold]'));
    const server = await start_test_server(undefined, 'postgresql', undefined, undefined, undefined, WAIT, ledger_register);
    try {
      const peer_process = await start_peer_process(server, PEER);
      const remote = peer_process.remote;
      const instances: (TestServer | RemoteServer)[] = [server, await start_peer_server(server), remote];
      // A remote test server signs with the time of the user's last response from it: the user logs in through it.
      const session = await login(remote, 'ledger_user');
      // 40 grants of 10 and 20 spends of 25: the spends ask 100 more than the grants give, so at least 4 fail.
      const requests = Array.from({ length: 60 }, (_, i) => request_id_of(i % 3 === 2 ? -SPEND : GRANT));
      // Request i goes to instance floor(i / 3) % 3: each instance runs grants and spends.
      const instance_of = (i: number): TestServer | RemoteServer => instances[Math.floor(i / 3) % instances.length] as TestServer | RemoteServer;
      expect(new Set(requests.flatMap((request_id, i) => (delta_of(request_id) < 0n ? [instance_of(i)] : []))).size, 'instances that run spends').toBe(instances.length);
      // The peer process passes the gate of each request at once and leaves in its note what the request saw.
      requests.forEach((request_id, i) => {
        if (instance_of(i) === remote) peer_process.open(seen_gate(request_id));
      });
      const results = await Promise.all(
        requests.map(async (request_id, i) => {
          const instance = instance_of(i);
          const { envelope } = await send({ ...session, server: instance }, 'RunCoreTest', new GameContract.RunCoreTestRequest(), request_id);
          return { request_id, delta: delta_of(request_id), code: envelope.error?.code ?? 0, envelope, remote: instance === remote };
        }),
      );
      // What the request saw where it ran: in the test process or in the peer process.
      const seen_by = async (r: (typeof results)[number]): Promise<Seen | undefined> => (r.remote ? read_seen_note(await peer_process.reached(seen_gate(r.request_id))) : seen.get(r.request_id));
      let sum = 0n;
      let refused = 0;
      // How often each balance is left by an accepted change minus how often one reaches it.
      const net = new Map<bigint, number>();
      const step = (balance: bigint, n: number): void => {
        net.set(balance, (net.get(balance) ?? 0) + n);
      };
      for (const r of results) {
        if (r.code === 0) {
          expect(r.envelope.item_changes.map((c) => [c.item_id, c.delta]), r.request_id).toEqual([[Number(gold), r.delta]]);
          const after = balance_in(r.envelope, gold);
          expect(after, r.request_id).not.toBeNull();
          const before = (after ?? 0n) - r.delta;
          expect(before >= 0n && (after ?? 0n) >= 0n, r.request_id).toBe(true);
          step(before, 1);
          step(after ?? 0n, -1);
          sum += r.delta;
        } else {
          // Only a spend fails, and only for a balance below it.
          expect([r.code, r.delta], r.request_id).toEqual([REFUSED, -SPEND]);
          const s = await seen_by(r);
          expect(s !== undefined && s.outcome === 'NOT_ENOUGH' && s.before < SPEND, r.request_id).toBe(true);
          refused += 1;
        }
      }
      expect(refused).toBeGreaterThanOrEqual(4);
      // The accepted changes chain from 0 to the sum one after the other: no two of them changed the same balance.
      for (const [balance, n] of net) expect(n, `balance ${String(balance)}`).toBe((balance === 0n ? 1 : 0) - (balance === sum ? 1 : 0));
      const stored = (await read_user_state(server, session.user_id)).find((s) => s.kind === 'ItemBalanceUserState' && s.item_id === gold);
      expect((stored?.value as CoreContract.ItemBalanceUserState | undefined)?.amount ?? 0n).toBe(sum);
    } finally {
      await stop_peer_processes();
      await stop_test_server(server);
    }
  }, T);
});
