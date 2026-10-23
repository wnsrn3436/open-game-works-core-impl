import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { bytes, encoded, Kind, kinds, leave, MAX_DURATION, new_user_id, open_match, pair, rejoin, signal, started, stop_all, TestConnection, trio } from './helpers.ts';

afterEach(() => {
  stop_all();
});

function only_frame(connection: TestConnection): CoreContract.MatchmakerFrame {
  const frames = connection.take();
  expect(frames).toHaveLength(1);
  const [f] = frames;
  if (f === undefined) throw new Error('no frame');
  return f;
}

function expect_failed(f: CoreContract.MatchmakerFrame, match_id: string): void {
  expect(f.kind).toBe(Kind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED);
  expect(f.match_id).toBe(match_id);
  expect(f.ok).toBe(false);
  expect(f.my_index).toBe(0);
  expect(f.players).toEqual([]);
  expect(f.transport).toBeNull();
  expect(f.left_indices).toEqual([]);
}

describe('MATCH_REJOIN', () => {
  it('binds a new connection of a disconnected participant and sends MATCH_REJOINED as MATCH_FOUND had it, and PEER_REJOINED to the others', async () => {
    const server = await started();
    server.fake?.set_result('issue_relays', [{ url: 'turn:relay.example:3478', username: 'u', credential: 'c' }]);
    const match = await open_match(server, 'm-rejoin', pair());
    const [c0, c1] = match.connections;
    server.p2p.connection_closed(c1);
    c0.take();

    const back = new TestConnection(c1.user_id);
    server.p2p.handle_frame(back, rejoin('m-rejoin'));
    const f = only_frame(back);
    expect(f.kind).toBe(Kind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED);
    expect(f.match_id).toBe('m-rejoin');
    expect(f.ok).toBe(true);
    expect(f.my_index).toBe(1);
    expect(f.players.map((p) => [...p.encode()])).toEqual(match.players.map((p) => [...p.encode()]));
    expect(encoded(f.transport)).toEqual(encoded(match.transport));
    expect(f.transport?.relays).toHaveLength(1);
    expect(f.left_indices).toEqual([]);
    expect(kinds(c0.take())).toEqual([{ kind: Kind.MATCHMAKER_FRAME_KIND_PEER_REJOINED, index: 1 }]);

    // bound again: signals reach it
    server.p2p.handle_frame(c0, signal(1, bytes(5)));
    expect(only_frame(back).index).toBe(0);
  });

  it('takes the connection still bound to the index out of the session without PEER_LEFT', async () => {
    const server = await started();
    const match = await open_match(server, 'm-replace', trio());
    const [c0, c1, c2] = match.connections;

    const back = new TestConnection(c1.user_id);
    expect(server.p2p.handle_frame(back, rejoin('m-replace'))).toEqual({ match_id: 'm-replace', index: 1, kind: 'REJOINED' });
    expect(only_frame(back).ok).toBe(true);
    expect(kinds(c0.take())).toEqual([{ kind: Kind.MATCHMAKER_FRAME_KIND_PEER_REJOINED, index: 1 }]);
    expect(kinds(c2.take())).toEqual([{ kind: Kind.MATCHMAKER_FRAME_KIND_PEER_REJOINED, index: 1 }]);
    expect(c1.take()).toEqual([]);

    // signals to index 1 reach only the new connection
    server.p2p.handle_frame(c0, signal(1, bytes(4)));
    expect(only_frame(back).index).toBe(0);
    expect(c1.take()).toEqual([]);
    // the old connection is bound nowhere: its signals go nowhere and its close changes nothing
    server.p2p.handle_frame(c1, signal(0, bytes(4)));
    expect(c0.take()).toEqual([]);
    expect(server.p2p.connection_closed(c1)).toBeNull();
    expect(c0.take()).toEqual([]);
    expect(c2.take()).toEqual([]);
    // the new connection is still bound
    server.p2p.handle_frame(c2, signal(1, bytes(6)));
    expect(only_frame(back).index).toBe(2);
  });

  it('lists the indices that left in left_indices, also an index whose connection went to a new match', async () => {
    const server = await started();
    const match = await open_match(server, 'm-three', trio());
    const [c0, c1, c2] = match.connections;
    server.p2p.handle_frame(c2, leave('m-three'));
    server.p2p.connection_closed(c1);
    const back = new TestConnection(c1.user_id);
    server.p2p.handle_frame(back, rejoin('m-three'));
    const f = only_frame(back);
    expect(f.ok).toBe(true);
    expect(f.left_indices).toEqual([2]);

    // index 0's connection goes to a new match: index 0 left m-three
    await open_match(server, 'm-next', [c0, new TestConnection(new_user_id())] as const);
    server.p2p.connection_closed(back);
    const back2 = new TestConnection(c1.user_id);
    server.p2p.handle_frame(back2, rejoin('m-three'));
    const g = only_frame(back2);
    expect(g.ok).toBe(true);
    expect(g.left_indices).toEqual([0, 2]);
  });

  it('fails for a participant that left, a user not in the match and a match whose expires_at has passed', async () => {
    const server = await started();
    const match = await open_match(server, 'm-fail', trio());
    const [c0, c1, c2] = match.connections;

    server.p2p.handle_frame(c2, leave('m-fail'));
    const left = new TestConnection(c2.user_id);
    expect(server.p2p.handle_frame(left, rejoin('m-fail'))).toBeNull();
    expect_failed(only_frame(left), 'm-fail');

    const stranger = new TestConnection(new_user_id());
    expect(server.p2p.handle_frame(stranger, rejoin('m-fail'))).toBeNull();
    expect_failed(only_frame(stranger), 'm-fail');

    const nowhere = new TestConnection(c0.user_id);
    expect(server.p2p.handle_frame(nowhere, rejoin('m-none'))).toBeNull();
    expect_failed(only_frame(nowhere), 'm-none');

    server.p2p.connection_closed(c1);
    c0.take();
    // one ms before expires_at the rejoin still works; at expires_at it fails
    server.clock.advance(MAX_DURATION - 1n);
    const early = new TestConnection(c1.user_id);
    server.p2p.handle_frame(early, rejoin('m-fail'));
    expect(only_frame(early).ok).toBe(true);
    server.p2p.connection_closed(early);
    c0.take();
    server.clock.advance(1n);
    const late = new TestConnection(c1.user_id);
    expect(server.p2p.handle_frame(late, rejoin('m-fail'))).toBeNull();
    expect_failed(only_frame(late), 'm-fail');
    expect(c0.take()).toEqual([]);

    // a failed rejoin leaves no log
    expect(server.core_logs().filter((line) => line.frame === 'MATCH_REJOIN')).toEqual([]);
  });

  it('fails for a connection bound to another match session and changes neither session', async () => {
    const server = await started();
    const a = await open_match(server, 'm-a', pair());
    const [a0, a1] = a.connections;
    server.p2p.connection_closed(a1);
    a0.take();
    const moved = new TestConnection(a1.user_id);
    const b = await open_match(server, 'm-b', [moved, new TestConnection(new_user_id())] as const);
    const [, b1] = b.connections;

    expect(server.p2p.handle_frame(moved, rejoin('m-a'))).toBeNull();
    expect_failed(only_frame(moved), 'm-a');
    expect(a0.take()).toEqual([]);
    expect(b1.take()).toEqual([]);

    // still bound to m-b
    server.p2p.handle_frame(b1, signal(0, bytes(3)));
    expect(only_frame(moved).index).toBe(1);
    // index 1 of m-a is still unbound
    server.p2p.handle_frame(a0, signal(1, bytes(3)));
    expect(moved.take()).toEqual([]);
    // and is not a left index: a connection bound nowhere can still rejoin it
    const free = new TestConnection(a1.user_id);
    server.p2p.handle_frame(free, rejoin('m-a'));
    const f = only_frame(free);
    expect(f.ok).toBe(true);
    expect(f.left_indices).toEqual([]);
  });
});
