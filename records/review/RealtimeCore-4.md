# review RealtimeCore round 4

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R4-1 | test evidence | medium | client/godot/core/realtime_core/tests/test_room.gd:1148 | `test_leave_room_and_room_kicked_cancel_the_room_matching_but_not_one_a_room_changed_subscriber_started` says that room kicked cancels the room's `Matching` (open-game-works-core/skills/client-core/modules/realtime-core.md:179), but its subscriber `_leave_and_join_match_on_room_gone_once` (test_room.gd:1261) calls `RealtimeCore.leave()` (:1264) first. With `_room` already null, that `leave` takes the non-room `Matching` path (realtime_core.gd:285-293) and itself ends `op` as `Cancelled`, so the assert at test_room.gd:1167 holds whether or not `_on_room_kicked` cancels anything. No other RealtimeCore test sends room kicked in `Matching` (the other `push_room_kicked` calls are in `None`, while `create_room` waits, or in `Playing`). Run: in a temporary worktree of 36b8f96, deleted the line `_cancel_room_matching(matching)` from `_on_room_kicked` (client/godot/core/realtime_core/realtime_core.gd:1165) and ran `ogw core test godot RealtimeCore`: 197 tests, 197 passed. The defect named by R3-2 in the kicked path (cancelling the wrong `Matching`, or not cancelling the room's own) can be restored without a failing test | Add a room kicked case in `Matching` (member from room updated `Matching`, and host `join_match`) whose subscriber does not call `leave`: the waiting `join_match`/`wait_match` ends `Cancelled`, `close` is called once and the state is `None`. Keep the `leave`+`join_match` subscriber case for the new `Matching` that must survive | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `_on_match_found` now runs the MatchInfo check and `_enter_connecting` (client/godot/core/realtime_core/realtime_core.gd:615-619) before `_publish_room_match_started` (:623), so a non-host member whose match found arrives in `None` publishes `RoomMatchStartedEvent` in `Connecting`, as realtime-core.md:272 defines. A subscriber's `wait_match` passes the check at :441 and waits; its `leave` takes the `Connecting` row (:294-299), and the `waiter != _waiter` check (:625) then stops the `connect_peer` loop. `leave_room` in `Connecting` keeps the match (realtime-core.md:178), and the loop goes on because the waiter is unchanged. Tests test_room.gd:898, :919, :943 cover the three subscriber cases |
| R3-2 | fixed | `_on_room_kicked` (realtime_core.gd:1163-1165) and `_leave_room_now` (:1180-1182) capture `_matching_waiter()` before `RoomChangedEvent`, and `_cancel_room_matching` (:1192) cancels only when that waiter is still the current `Matching`. A `join_match` started by a subscriber in `None` gets a new waiter, so it is not cancelled and calls `start_matching` (test_room.gd:1124 checks both `Left` and `Kicked`). The room's own `Matching` is still cancelled when the subscriber does nothing; the kicked path of that has no failing test, see R4-1 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D6 | fixed | none | Same problem as R3-1, fixed in commit 9178931: `RoomMatchStartedEvent` of a match found in `None` is published after `_enter_connecting` (client/godot/core/realtime_core/realtime_core.gd:619-623) |
| D7 | fixed | none | Same problem as R3-2, fixed in commit 9178931: `_cancel_room_matching(waiter)` (client/godot/core/realtime_core/realtime_core.gd:1192) ignores a `Matching` started after the `RoomChangedEvent` publish |

## must fix

none

## unknown

- The commit range changes only client/godot/core/realtime_core/ (commit 9178931); the other files of the range belong to other modules and were not reviewed.
- The kicked-path claim of R4-1 was run on the native Godot target only, not `--web`. The other new tests were not run with the old code restored in this round; the core agent report says the five new test_room.gd tests failed on the code before 9178931.
- With the match found in `None`, a member whose `MatchInfo` check fails now publishes no `RoomMatchStartedEvent` (realtime_core.gd:615-617). realtime-core.md:187 lists the publish before steps 3 to 5, while :272 publishes only when the member became `Matching` or `Connecting`. This was judged by :272, which R3-1 relied on; the core agent report has a spec proposal for :187.
- Game code and the benchmark game were not checked for `RoomMatchStartedEvent` subscribers that relied on `leave_room` ending a match found in `None` (now it keeps the match in `Connecting`).
