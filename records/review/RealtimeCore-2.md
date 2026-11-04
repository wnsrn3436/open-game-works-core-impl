# review RealtimeCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | open | `spec change` `yes`; the spec and this path did not change in the range (input `## spec changes` is `none`). `_on_room_updated` still calls `close` on the `Open` (client/godot/core/realtime_core/realtime_core.gd:1112), and open-game-works-core/skills/client-core/modules/realtime-core.md:107 and :394 still disagree. Run again at the head of the range in a temporary copy, on `P2pRealtimeTransport` with the test matchmaker: a non-host member in `Matching` receives `ROOM_STATE`(`Open`), `ROOM_STATE`(`Matching`), `MATCH_FOUND` in one `poll`, and transport `_match_id` is `""` where a held match would be `match-p2p`. The new check in `_on_match_found` does not reach this path, because `_room_started_published` is already true there |
| R1-2 | fixed | `_on_match_found` (client/godot/core/realtime_core/realtime_core.gd:616 to :623) now returns when a subscriber changed `_change_count`. The tests pass at the head. With that check removed in a temporary copy they fail: `test_leave_room_from_room_match_started_of_a_match_found_in_none_ends_that_match_and_the_rest_of_the_poll` gets calls `leave_room()`, `close()`, `connect_peer(0)` and saved match ID `match-0001`; `test_leave_room_and_create_room_from_room_match_started_keep_the_new_room_operation` gets `connect_peer` count 1; `test_release_from_room_match_started_of_a_match_found_in_none_ends_the_handling` gets the script error of `connect_peer` on `Nil`; `test_leave_room_from_room_match_started_leaves_the_match_of_that_match_found` (P2P) gets state 2 and `_match_id` `match-p2p` |
| R1-3 | open | `spec change` `yes`. In the range, no file under `server/` changed, and neither did client/godot/core/realtime_core/p2p_realtime_transport.gd:323, which still sends `MATCH_LEAVE` of the second match and keeps the first. open-game-works-core/skills/client-core/modules/realtime-core.md:298 and open-game-works-core/skills/server-core/modules/matchmaker.md:374 are as round 1 read them. Checked by reading, not run |
| R1-4 | open | `spec change` `yes`. client/godot/core/realtime_core/p2p_realtime_transport.gd:491 to :493 still logs a failed `connect_peer` once per match through `_connect_failed_logged`, and open-game-works-core/skills/client-core/modules/realtime-core.md:299 still sets `warn` with no such limit |
| R1-5 | fixed | `test_match_found_while_holding_a_match_leaves_the_new_match_once_and_close_leaves_the_first` (client/godot/core/realtime_core/tests/test_p2p.gd:794) passes at the head and fails on both restored defects in a temporary copy. `MATCH_LEAVE` of the second match sent twice: `leaves[1]` is `match-second` where `match-p2p` is expected, and the count is 3 where 2 is expected. `close` skipping `MATCH_LEAVE` of the first after a second `MATCH_FOUND` (the mutation of round 1, which the fix report did not run): out of bounds on `leaves[1]` and test time limit 30000 ms passed |

## out of scope

- client/godot/core/realtime_core/realtime_core.gd:617: medium `RoomMatchStartedEvent` of a match found in `None` is published while `MatchState` is still `None`, before `_enter_connecting`. open-game-works-core/skills/client-core/modules/realtime-core.md:271 defines the event as "when a non-host member became `Matching` or `Connecting`", while :186 publishes it before steps 3 to 5 of `join_match`. `ROOM_START` leaves the room `Open` (:184), so this is the path of every non-host member of a `start_room`. Run on the P2P transport in a temporary copy: a subscriber reads `match_state` 0 (`None`), and the `wait_match` it calls has already ended, because `wait_match` refuses `None` with a warn and `Failed` (realtime_core.gd:441). The match goes on to `Connecting` without that waiter. By reading, `leave` in the same subscriber only logs `leave: no match`, so the subscriber cannot leave the match with it. The publish line existed before the range
- client/godot/core/realtime_core/realtime_core.gd:1190: medium `_cancel_room_matching` ends a `join_match` that a `RoomChangedEvent` subscriber just started. `_leave_room_now` (:1166) and `_on_room_kicked` (:1182) check `MatchState` after they publish the event, so they treat that new `Matching` as the `Matching` of the room that was left. Run on the fake transport in a temporary copy: a member in `None` and a subscriber that calls `join_match` on `Left` or `Kicked`. The state is `None` and the `join_match` has ended where `Matching` and a waiting call are expected, and on `Kicked` the `start_matching` count is 0. By reading, its `status` is `Cancelled`. open-game-works-core/skills/client-core/modules/realtime-core.md:177 and :178 cancel the `Matching` of the room and do not set this order. The check existed before the range

## debt

none

## must fix

none

## unknown

- The runs of this round were native only, with `ogw core test godot RealtimeCore --file` on `tests/test_room.gd` and `tests/test_p2p.gd`. Both files pass at the head of the range. The browser run (`--web`) was not run, and the fix report says it passed.
- The other test files of RealtimeCore and the modules that depend on it (`BootstrapCore`, `QACore`, `UnitTestCore`) were not run. The fix report says it ran them on commit 8edc482.
- R1-3 was checked by reading and was not run in this review.
- The `status` value in the second `## out of scope` line was read from the code, because the temporary test checked the state and that the call ended, not the `status`. On `Left`, the `start_matching` count of that test was not cleared before the call, so only the `Kicked` count is used as evidence.
- The `_set_none` branch alone in `_on_match_found` was not mutated. By reading, the next `_begin_match` resets what it clears.
- Items `D1` to `D5` of records/review-debt/RealtimeCore.json and `D1` of records/review-debt/spec-RealtimeCore.json were not given by the input, so no result is written for them. `D5` is only looked at as R1-3.
