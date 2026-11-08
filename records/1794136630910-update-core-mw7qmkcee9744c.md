# update core: RealtimeCore (Godot)

## done

- `RealtimeCore` (Godot), commit 189e4830 on `agent/mw7qmkcee9744c`
  - transport `close` takes the forfeit flag: `RealtimeTransport.close(forfeit: bool)` (`client/godot/core/realtime_core/realtime_transport.gd`). The wrapping transports `LockstepRealtimeTransport` and `SimRealtimeTransport` pass it on unchanged
  - RealtimeCore passes `true` only from match end with `Left` or `BackgroundTimeout` (`_end_match_now`: `reason != MatchEndReason.ENDED`). Every other `close` passes `false`: `leave` in `Matching` and `Connecting`, a `join_match` failure (`_fail_match`), a discarded match found, `leave_room` in `None`, a room returning to `Open`, and `Matching` cancelled by a room leave
  - P2P transport: `close` sends `MATCH_LEAVE` (`match_id`, `forfeit` = the flag) before it starts the close of the matchmaker connection. The close frame still goes out `_CLOSE_DELAY_POLLS` polls later, as before. The `MATCH_LEAVE`s that the transport sends by itself (a second `MATCH_FOUND`, a relay-only `MATCH_FOUND` with empty `relays`) have `forfeit` `false`
  - P2P transport: `HELLO` has `platform` = `CoreBuildInfo.platform`, which is the build info `platform` that `BootstrapCore` sets (`## module` of the Godot rules). The constructor of the transport is unchanged, so `BootstrapCore` needs no change
- A caller in another module had to follow: `UnitTestRealtimeTransport` (`client/godot/core/unit_test_core/dev/unit_test_realtime_transport.gd`, the fake realtime transport of `UnitTestCore`) overrides `close`, so its signature had to change too. It records `close` with the input `["true"]` or `["false"]`, the same way it records the `lockstep` flag of `start_matching`. The spec says it records each call with its input. `unit_test_core/tests/test_realtime.gd` now also checks that input
- Tests
  - `test_peers.gd`: `leave` in `Playing` records `close(true)` and `end_match` records `close(false)`. The match end of `BackgroundTimeout` gives `send_packet(1, 0)` and then `close(true)`
  - `test_join.gd`: `leave` in `Matching` and in `Connecting`, every `join_match` failure (`_assert_failed`) and a discarded match found record `close(false)`
  - Every other expected call list in `test_dev`, `test_rejoin` and `test_room` now states the flag, and all of them are `false`. The test recording transport records `close(<flag>)`
  - `test_p2p.gd`:
    - `HELLO` `platform` is the build info platform
    - `close(true)` sends `MATCH_LEAVE` with `forfeit` `true` and then the close; `close(false)` sends it with `false`
    - the `MATCH_LEAVE` of a second `MATCH_FOUND`, of a relay-only `MATCH_FOUND` with empty `relays` and of a discarded match found has `forfeit` `false`
    - new `test_leave_in_playing_out_of_a_room_sends_a_forfeit_match_leave_before_the_close`: the fake server receives `MATCH_LEAVE` with `forfeit` `true`, and then the close of that connection
    - new `test_leave_in_playing_while_in_match_rejoin_waits_its_delay_sends_no_match_leave`: no `MATCH_LEAVE`, no new connection, and no second `MATCH_REJOIN`
- Last runs, on commit 189e4830 (no uncommitted changes):
  - `ogw core test godot "RealtimeCore UnitTestCore BootstrapCore QACore"`: all pass, 565/565
  - the same with `--web`: all pass, 557/557
  - These are the edited modules (`RealtimeCore`, `UnitTestCore`) and every module that `ogw core dependents RealtimeCore UnitTestCore` lists (`BootstrapCore`, `QACore`)
  - `ogw code check core`: type check, lint, dependency and secret all pass
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

none

## review

none

## unverified

- Earlier test runs on this branch, before the final runs, hit two intermittent failures. The final runs above passed both of them. I did not find their causes:
  - Two `test_p2p.gd` runs failed only on the engine lines `ERROR: Not enough response headers. Got: 2, expected >= 4.` / `ERROR: Invalid response headers.`: one full native RealtimeCore run (200 of 201 tests passed) and one `--file test_p2p.gd` run. Every test of those runs passed. These are the same lines that `records/1793992601471-review-fix-mw5cviin936022.md` and `records/1793995804774-review-fix-mw5es67a25c76b.md` report as an intermittent RealtimeCore failure on main before this change. Their cause was not checked there either. A run with marks around the two new tests did not show the lines, so I could not tie them to a test. They look like a WebSocket handshake that gets a short HTTP response, perhaps a transport that connects to a test relay after the relay closed. That guess was not reproduced
  - One `--file test_p2p.gd` run with the two new tests disabled failed `test_a_member_whose_match_failed_and_match_found_come_in_one_poll_sends_one_match_leave` (`[0] expected to equal [1]`, the `MATCH_LEAVE` count after `frames(10)`). That test and the code it covers did not change apart from the flag value `false`. It passed in all the other runs. It looks timing dependent (the relay delivery within 10 frames) while other agents' test runs loaded the host. The cause was not checked
- The server side of the forfeit (`matchmaker` counting a forfeiter from `MATCH_LEAVE`) is not part of this client change and was not run here. The client tests check only the frames that the fake WebSocket server receives
