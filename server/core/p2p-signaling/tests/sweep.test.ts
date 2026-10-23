import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { core_settings_value, leave, MAX_DURATION, new_user_id, open_match, pair, player, rejoin, started, stop_all, TestConnection, type Server } from './helpers.ts';

afterEach(() => {
  stop_all();
});

/** Whether the match has a session: `open_match_session` throws for a `match_id` that has one. */
function has_session(server: Server, match_id: string): boolean {
  const probe = new TestConnection(new_user_id());
  try {
    server.p2p.open_match_session(match_id, [player(probe.user_id, 0)], [probe], new CoreContract.Transport(), server.clock.now() + MAX_DURATION);
  } catch {
    return true;
  }
  // the probe session is opened under the match ID; leaving it does not matter to the test
  server.p2p.handle_frame(probe, leave(match_id));
  return false;
}

describe('p2p_session_sweep', () => {
  it('removes the sessions every participant left and the sessions whose expires_at has passed', async () => {
    const interval = BigInt(core_settings_value('p2p-signaling.sweepIntervalMs'));
    const server = await started();
    const gone = await open_match(server, 'm-gone', pair());
    const dropped = await open_match(server, 'm-dropped', pair());
    await open_match(server, 'm-live', pair());
    const late = await open_match(server, 'm-late', pair(), server.clock.now() - MAX_DURATION + interval);
    for (const c of gone.connections) server.p2p.handle_frame(c, leave('m-gone'));
    for (const c of dropped.connections) server.p2p.connection_closed(c);
    for (const match_id of ['m-gone', 'm-dropped', 'm-live', 'm-late']) expect(has_session(server, match_id)).toBe(true);

    // a disconnected participant can rejoin before the sweep
    const early = new TestConnection(dropped.connections[0].user_id);
    server.p2p.handle_frame(early, rejoin('m-dropped'));
    expect(early.take()[0]?.ok).toBe(true);
    server.p2p.connection_closed(early);

    const [l0, l1] = late.connections;
    server.clock.advance(interval);
    await server.idle();
    // m-live still has its connections; m-late expired at this clock time
    expect(has_session(server, 'm-live')).toBe(true);

    // a session with no bound connection is gone: the disconnected participant cannot rejoin any more
    const after = new TestConnection(dropped.connections[1].user_id);
    server.p2p.handle_frame(after, rejoin('m-dropped'));
    expect(after.take()[0]?.ok).toBe(false);

    // the connections of the removed expired session are bound nowhere
    expect(server.p2p.connection_closed(l0)).toBeNull();
    const next = await open_match(server, 'm-after', [l1, new TestConnection(new_user_id())] as const);
    expect(next.changes).toEqual([]);

    // the removed sessions' match IDs have no session
    for (const match_id of ['m-gone', 'm-dropped', 'm-late']) expect(has_session(server, match_id)).toBe(false);
  });
});
