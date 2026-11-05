# review RealtimeCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/realtime_core/p2p_realtime_transport.gd:457 | The range changed the `_restart_offers` condition from `not peer.is_offerer` to `_my_index > index` so that rejoined of in-match rejoin also restarts a connection whose `connect_peer` failed and that no read has found failed yet (realtime-core.md:118 "has a P2P connection being made", :124 a connection that is not connected is being made, :300 peer lost only when the transport does not drop that connection before the read). No test covers it: the only tests that make a failed connection (`_FailingTransport` in client/godot/core/realtime_core/tests/test_p2p.gd:868, :1014, :1033, :1061) never send `MATCH_REJOINED`, and every `MATCH_REJOINED` test (test_p2p.gd:44, :436, :561, :624, :666, :846, :1397) uses connections that started. Run path with the change reverted: `_FailingPeer.start` returns `false` before `is_offerer` is set (test_p2p.gd:1753-1756), so index 0 with `connect_peer`(1) failed and then reading `MATCH_REJOINED` `ok` `true` of the same match in the next `poll` skips index 1 in `_restart_offers`, and the read of that `poll` raises peer lost of index 1 and the `connect_peer failed` warn log (p2p_realtime_transport.gd:493-499), against "drops that connection without peer lost" of realtime-core.md:118. No test fails | Add a P2P transport test: itself at index 0, `connect_peer`(1) fails at start, then a `poll` reads `MATCH_REJOINED` `ok` `true` of the same match; assert no peer lost of index 1, no warn log, one offer `PEER_SIGNAL` to index 1 with the next attempt number, and peer connected when it connects | no | 82 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The Godot core tests were not run in this review; test behavior was judged by reading the tests and the transport code.
- server/core/matchmaker/realtime.ts:758 (`p2p_frame` no longer awaits `results.participant_change`) is in the commit range but belongs to server `matchmaker`, not to RealtimeCore; it was only read to see that `participant_change` catches its own failure (server/core/matchmaker/results.ts:386-395), and was not reviewed against the matchmaker spec.
- Behavior of the web engine (refused SDP after the call returned, WebRTC state transitions in the browser) was not checked; only the Godot native WebRTC path was read.
