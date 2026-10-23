import { bytes, Kind, kinds, leave, new_user_id, open_match, pair, rejoin, signal, started, stop_all, TestConnection, trio } from './helpers.ts';

afterEach(() => {
  stop_all();
});

describe('leave and disconnect', () => {
  it('sends PEER_LEFT to the others after MATCH_LEAVE and after a disconnect, and drops PEER_SIGNAL to the participant that went', async () => {
    const server = await started();
    const match = await open_match(server, 'm-leave', trio());
    const [c0, c1, c2] = match.connections;

    server.p2p.handle_frame(c2, leave('m-leave'));
    expect(kinds(c0.take())).toEqual([{ kind: Kind.MATCHMAKER_FRAME_KIND_PEER_LEFT, index: 2 }]);
    expect(kinds(c1.take())).toEqual([{ kind: Kind.MATCHMAKER_FRAME_KIND_PEER_LEFT, index: 2 }]);
    expect(c2.take()).toEqual([]);
    server.p2p.handle_frame(c0, signal(2, bytes(1)));
    expect(c2.take()).toEqual([]);

    server.p2p.connection_closed(c1);
    expect(kinds(c0.take())).toEqual([{ kind: Kind.MATCHMAKER_FRAME_KIND_PEER_LEFT, index: 1 }]);
    server.p2p.handle_frame(c0, signal(1, bytes(1)));
    expect(c1.take()).toEqual([]);
    expect(c2.take()).toEqual([]);
  });

  it('drops a MATCH_LEAVE for a match the connection is not bound to with a debug log', async () => {
    const server = await started();
    const match = await open_match(server, 'm-leave-other', pair());
    const [c0, c1] = match.connections;
    expect(server.p2p.handle_frame(c0, leave('m-unknown'))).toBeNull();
    expect(c1.take()).toEqual([]);
    expect(server.core_logs().filter((line) => line.level === 'debug' && line.frame === 'MATCH_LEAVE')).toHaveLength(1);
    // still bound
    server.p2p.handle_frame(c0, signal(1, bytes(1)));
    expect(c1.take()).toHaveLength(1);
  });

  it('takes a connection bound to a new match out of its previous session as a leave', async () => {
    const server = await started();
    const old = await open_match(server, 'm-old', pair());
    const [o0, o1] = old.connections;
    const fresh = await open_match(server, 'm-new', [o1, new TestConnection(new_user_id())] as const);
    expect(fresh.changes).toEqual([{ match_id: 'm-old', index: 1, kind: 'LEFT' }]);
    expect(kinds(o0.take())).toEqual([{ kind: Kind.MATCHMAKER_FRAME_KIND_PEER_LEFT, index: 1 }]);

    // the old session no longer reaches it
    server.p2p.handle_frame(o0, signal(1, bytes(1)));
    expect(o1.take()).toEqual([]);

    // the user's MATCH_REJOIN to the previous match fails, even from a connection bound nowhere
    const again = new TestConnection(o1.user_id);
    server.p2p.handle_frame(again, rejoin('m-old'));
    const answer = again.take();
    expect(answer).toHaveLength(1);
    expect(answer[0]?.kind).toBe(Kind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED);
    expect(answer[0]?.ok).toBe(false);
  });

  it('returns LEFT, DISCONNECTED and REJOINED participant changes, and none for a connection bound to no session', async () => {
    const server = await started();
    const match = await open_match(server, 'm-changes', trio());
    expect(match.changes).toEqual([]);
    const [, c1, c2] = match.connections;
    expect(server.p2p.handle_frame(c2, leave('m-changes'))).toEqual({ match_id: 'm-changes', index: 2, kind: 'LEFT' });
    expect(server.p2p.connection_closed(c1)).toEqual({ match_id: 'm-changes', index: 1, kind: 'DISCONNECTED' });
    const back = new TestConnection(c1.user_id);
    expect(server.p2p.handle_frame(back, rejoin('m-changes'))).toEqual({ match_id: 'm-changes', index: 1, kind: 'REJOINED' });

    const loose = new TestConnection(new_user_id());
    expect(server.p2p.handle_frame(loose, leave('m-changes'))).toBeNull();
    expect(server.p2p.handle_frame(loose, signal(0, bytes(1)))).toBeNull();
    expect(server.p2p.connection_closed(loose)).toBeNull();
    // c2 left and c1 was closed: neither is bound any more
    expect(server.p2p.connection_closed(c2)).toBeNull();
    expect(server.p2p.connection_closed(c1)).toBeNull();
  });
});
