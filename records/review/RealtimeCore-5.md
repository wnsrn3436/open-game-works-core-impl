# review RealtimeCore round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | New test `test_room_kicked_in_matching_closes_once_and_cancels_the_pending_operation` (client/godot/core/realtime_core/tests/test_room.gd:1178) sends room kicked in `Matching` with no subscriber that calls `leave`, for a non-host member `wait_match`, a host `join_match` and a host `start_room`, and checks `Cancelled` with error code 0, transport calls exactly `close()`, events exactly `room:KICKED`, `MatchState` `None`, empty `RoomInfo` and no warn log (realtime-core.md:179). Restored the defect in a temporary worktree of 02b64d9 under worktrees/_core/: replaced `_cancel_room_matching(matching)` with `_cancel_room_matching(null)` in `_on_room_kicked` (client/godot/core/realtime_core/realtime_core.gd:1165), so the room's `Matching` is not cancelled. `ogw core test godot RealtimeCore --file client/godot/core/realtime_core/tests/test_room.gd` failed this test: "member wait_match: the operation ended" false, transport calls `disconnect()` instead of `close()`, the later cases did not reach the room, and the test time limit of 30000 ms passed. With the line restored the same run passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range changes only client/godot/core/realtime_core/tests/test_room.gd in RealtimeCore (commit 08da257); the other files of the range belong to other modules or are records and were not reviewed.
- The defect-restore run and the passing run were native Godot runs of test_room.gd only, not `--web` and not the whole RealtimeCore suite.
