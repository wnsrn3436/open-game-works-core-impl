import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { bytes, Kind, kinds, MAX_DURATION, new_user_id, open_match, pair, player, rejoin, signal, started, stop_all, TestConnection } from './helpers.ts';

afterEach(() => {
  stop_all();
});

describe('open_match_session', () => {
  it('throws for a match_id that has a session, a connection given twice and a connection count other than the players count, and changes no session', async () => {
    const server = await started();
    const old = await open_match(server, 'm-open', pair());
    const [o0, o1] = old.connections;
    const transport = new CoreContract.Transport();
    const expires_at = server.clock.now() + MAX_DURATION;
    const fresh = new TestConnection(new_user_id());

    // the match_id has a session
    const again = [fresh, new TestConnection(new_user_id())] as const;
    expect(() =>
      server.p2p.open_match_session(
        'm-open',
        again.map((c, i) => player(c.user_id, i)),
        again,
        transport,
        expires_at,
      ),
    ).toThrow();
    // a connection given twice: o1 is bound to m-open
    expect(() => server.p2p.open_match_session('m-twice', [player(o1.user_id, 0), player(o1.user_id, 1)], [o1, o1], transport, expires_at)).toThrow();
    // fewer connections than players
    expect(() => server.p2p.open_match_session('m-short', [player(o1.user_id, 0), player(fresh.user_id, 1)], [o1], transport, expires_at)).toThrow();

    // m-open is unchanged: no PEER_LEFT, both connections still bound to their index
    expect(o0.take()).toEqual([]);
    expect(o1.take()).toEqual([]);
    server.p2p.handle_frame(o0, signal(1, bytes(1)));
    expect(kinds(o1.take())).toEqual([{ kind: Kind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL, index: 0 }]);
    server.p2p.handle_frame(o1, signal(0, bytes(1)));
    expect(kinds(o0.take())).toEqual([{ kind: Kind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL, index: 1 }]);
    // the connections of the failed calls are bound nowhere
    expect(server.p2p.connection_closed(fresh)).toBeNull();
    expect(server.p2p.connection_closed(again[1])).toBeNull();

    // the failed calls made no session: a rejoin to them fails and the match IDs can still be opened
    for (const match_id of ['m-twice', 'm-short']) {
      const probe = new TestConnection(o1.user_id);
      server.p2p.handle_frame(probe, rejoin(match_id));
      expect(probe.take().map((f) => f.ok)).toEqual([false]);
    }
    const twice = await open_match(server, 'm-twice', pair());
    expect(twice.changes).toEqual([]);
    const short = await open_match(server, 'm-short', pair());
    expect(short.changes).toEqual([]);
  });
});
