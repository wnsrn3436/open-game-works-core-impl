# review RealtimeCore round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | The spec change settles the behavior: open-game-works-core/skills/client-core/modules/realtime-core.md:107 now says a member whose room returned to `Matching` in that `poll` takes the match found, has nothing to connect, and fails at the connect time limit, which agrees with :394 and with the code (`_transport.close()` at client/godot/core/realtime_core/realtime_core.gd:1112, the `_state == MatchState.NONE` condition at :525). The new test `test_a_member_whose_room_returned_to_matching_in_one_poll_takes_the_match_found_and_fails_at_the_connect_time_limit` (client/godot/core/realtime_core/tests/test_p2p.gd:959) runs this on the P2P transport and passes at the head. In a temporary copy it fails with the `close` at :1112 removed (`MATCH_LEAVE` count 0 where 1 is expected), and with the `_state == MatchState.NONE` condition removed from :525 (the match found is discarded and the state check fails, then test time limit 30000 ms passed) |
| R1-3 | fixed | The second match no longer reaches a member in a running match. `host_error` (server/core/matchmaker/realtime.ts:577) gives `ROOM_BUSY` while a member's connection is bound, as open-game-works-core/skills/server-core/modules/matchmaker.md:146 and :151 now set, and that covers both `ROOM_START` and the host `MATCH_REQUEST`. `answers ROOM_START and a host MATCH_REQUEST with ROOM_BUSY while a member connection is bound` (server/core/matchmaker/tests/rooms.test.ts:653) passes at the head on SQLite and PostgreSQL, and fails on both with that check removed in a temporary copy. The client line client/godot/core/realtime_core/p2p_realtime_transport.gd:323 is unchanged and still follows realtime-core.md:298. By reading, `ROOM_BUSY` on the client goes through `_fail_room_match`, and its `cancel_matching` is dropped by the server when the room has no entry (server/core/matchmaker/realtime.ts:631). The client-to-server path was not run as one test, see `## unknown` |
| R1-4 | fixed | open-game-works-core/skills/client-core/modules/realtime-core.md:299 now says `warn, once per match`, which is the behavior of client/godot/core/realtime_core/p2p_realtime_transport.gd:492 to :494, reset at :427. In a temporary copy, `test_a_connection_that_does_not_start_raises_peer_lost_at_the_next_poll` (client/godot/core/realtime_core/tests/test_p2p.gd:744) fails with the reset removed (0 where 1 is expected, "the warn log of the next match"), and that test and `test_connect_peer_that_fails_ends_at_the_connect_time_limit_in_realtime_core` (:769) fail with the once limit removed (2 and 5 where 1 is expected) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The runs of this round were native only, in temporary clones at the head of the range. `ogw core test godot RealtimeCore --file` passes on `tests/test_p2p.gd` and `tests/test_room.gd`, and `ogw core test server` passes on `matchmaker` `tests/rooms.test.ts` and `p2p-signaling` `tests/leave.test.ts`. The browser run (`--web`) was not run. The other test files of RealtimeCore and the modules that depend on it (`BootstrapCore`, `QACore`, `UnitTestCore`) were not run.
- R1-3 was not run with `RealtimeCore` and the real matchmaker together. The server side was run with its server test, and the client side was read. The client tests give `ROOM_BUSY` through the fake transport (client/godot/core/realtime_core/tests/test_room.gd:663, :693), not because a member is bound.
- The fix report records that `is_bound` is checked only before member rating resolution, so a member's own `MATCH_REJOIN` could bind that member during resolution, and it proposes a spec decision. It was not reproduced here. By reading, `RealtimeCore` does not send `MATCH_REJOIN` on the connection of a room: `rejoin_match` is refused in a room, and transport `rejoin` closes that connection and opens a new one. The window in which the old connection is still closing (`_CLOSE_DELAY_POLLS`) was not checked. It is left to the review of `matchmaker`.
- Items `D1` to `D7` of records/review-debt/RealtimeCore.json and `D1` of records/review-debt/spec-RealtimeCore.json were not given by the input, so no result is written for them, and `D6` and `D7` were not examined again. `D5` is the problem of R1-3, which is `fixed` in this round, and it is still in that list.
