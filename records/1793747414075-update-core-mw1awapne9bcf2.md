# update core RealtimeCore

## done

- `RealtimeCore`, godot. R7-1 and R7-2 of `records/review/RealtimeCore-7.md`, as `realtime-core.md:107` and `:184` now state them.
- `_frame` (`client/godot/core/realtime_core/realtime_core.gd`): `_room_leave_count` now counts each `leave_room` that left a room or ended a wait, in any state, and discards the remaining room updated, room failed and room kicked of that `poll`. The new `_room_leave_none_count` counts those that left `MatchState` at `None`, and discards all the remaining notifications, as before. Other notifications of a match in `Connecting` or `Playing` stay handled.
- `_on_room_failed`: `ROOM_BUSY` of `Start` in the `Matching` of `start_room` also calls transport `cancel_matching`, through `_fail_room_match`, which `Match` now uses too.
- Tests in `client/godot/core/realtime_core/tests/test_room.gd`, with the helper `join_match_then_create_room` in `tests/support/realtime_async_call.gd`:
  - order (a) of R7-1: `test_leave_room_leave_and_create_room_from_a_room_event_in_playing_do_not_take_the_rest_of_the_room_notices`. It also holds room failed and room kicked after the `None`, and that matchmaker lost stays handled there
  - order (b) of R7-1: `test_leave_room_in_connecting_and_create_room_in_the_continuation_of_a_later_failure_do_not_take_the_rest_of_the_room_notices`
  - `test_leave_room_from_a_room_event_in_playing_discards_room_failed_and_room_kicked_of_the_poll`
  - notice order of R7-2: `test_host_cancels_the_entry_on_room_busy_of_a_start_room_that_retried_before_its_matching_arrived`
  - `test_host_start_room_plays_after_match_found_and_fails_on_start_room_failed` now also holds that another `Start` failure does not cancel
- The four new tests were run with `--file` against `realtime_core.gd` of the commit before this change, and each failed: `create_room` done at once for (a) and (b), one warn log for room failed, `close()` only for R7-2. That run was made before the matchmaker lost part was moved into the test of order (a); the test's first part, which failed, did not change.
- Last runs: `ogw core test godot` and `ogw core test godot --web` with `RealtimeCore BootstrapCore QACore UnitTestCore`. `--web`: all pass, exit code 0. Native: `RealtimeCore`, `BootstrapCore`, `UnitTestCore` pass, `QACore` skipped because its render pass did not run (the macOS screen is locked or the display sleeps), exit code 1. `ogw code check core`: type check, lint, dependency, secret pass.
- No engine-specific implementation rules document and no `## <engine> build` of `tools/ogw.md` were written.

## spec proposals

none

## review

none

## unverified

- The native render pass of `QACore` did not run because of the screen lock. The human can unlock the screen and run `ogw core test godot QACore`.
- All new tests use the recording transport. No run used the real matchmaker server or `p2p_realtime_transport.gd`, for these orders or for the server's answer to `MATCH_CANCEL` after `ROOM_BUSY` of `ROOM_START`.
- A `leave_room` that only leaves a warn log (no room and no wait) discards nothing, as before. I read `realtime-core.md:176` ("only leaves a warn log") and the reason given at `:107` ("the room that was left") as applying to it, though `:107` read word for word says any `leave_room` called inside `poll`. No test holds this.
- After a `leave_room` in `Connecting` or `Playing` and a later `None` in one `poll`, a matchmaker lost still handled there ends a `create_room` started in that `poll` with `ok` `false`, even when it is the loss of the earlier connection. This follows `:107`, which keeps matchmaker lost in `None`; the test of order (a) holds it. Whether such a notice can follow `close` in one `poll` with the P2P transport was not checked.
