import { bytes, core_settings_value, Kind, new_user_id, open_match, pair, signal, started, stop_all, TestConnection, trio } from './helpers.ts';

afterEach(() => {
  stop_all();
});

describe('PEER_SIGNAL', () => {
  it('reaches only the target participant, with the sender index and the same payload', async () => {
    const server = await started();
    const match = await open_match(server, 'm-signal', trio());
    const [c0, c1, c2] = match.connections;
    const payload = bytes(1, 2, 3, 250);
    expect(server.p2p.handle_frame(c0, signal(2, payload))).toBeNull();
    const got = c2.take();
    expect(got).toHaveLength(1);
    expect(got[0]?.kind).toBe(Kind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL);
    expect(got[0]?.index).toBe(0);
    expect([...(got[0]?.payload ?? [])]).toEqual([...payload]);
    expect(c0.take()).toEqual([]);
    expect(c1.take()).toEqual([]);

    server.p2p.handle_frame(c2, signal(1, bytes(9)));
    const back = c1.take();
    expect(back.map((f) => f.index)).toEqual([2]);
    expect([...(back[0]?.payload ?? [])]).toEqual([9]);
    expect(c0.take()).toEqual([]);
  });

  it('goes to no one from a connection of another match, to an index out of range or its own, with an empty payload or one over the limit', async () => {
    const max = core_settings_value('p2p-signaling.maxPayloadBytes');
    const server = await started();
    const a = await open_match(server, 'm-a', trio());
    const b = await open_match(server, 'm-b', pair());
    const outsider = new TestConnection(new_user_id());
    const all = [...a.connections, ...b.connections, outsider];
    const [a0] = a.connections;

    server.p2p.handle_frame(outsider, signal(1, bytes(1)));
    server.p2p.handle_frame(a0, signal(-1, bytes(1)));
    server.p2p.handle_frame(a0, signal(3, bytes(1)));
    server.p2p.handle_frame(a0, signal(0, bytes(1)));
    server.p2p.handle_frame(a0, signal(1, new Uint8Array(0)));
    server.p2p.handle_frame(a0, signal(1, new Uint8Array(max + 1)));
    for (const c of all) expect(c.take()).toEqual([]);
    const dropped = server.core_logs().filter((line) => line.level === 'debug' && line.frame === 'PEER_SIGNAL');
    expect(dropped).toHaveLength(6);

    // a participant of match b reaches index 1 of match b, never index 1 of match a
    server.p2p.handle_frame(b.connections[0], signal(1, bytes(7)));
    expect(b.connections[1].take()).toHaveLength(1);
    for (const c of a.connections) expect(c.take()).toEqual([]);

    // the limit itself is allowed
    server.p2p.handle_frame(a0, signal(1, new Uint8Array(max)));
    expect(a.connections[1].take()).toHaveLength(1);
  });
});
