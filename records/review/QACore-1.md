# review QACore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/qa_core/dev/qa_builtins.gd:292: medium `test evidence`. `## test` of the QACore spec requires that the `ok` of `drop_matchmaker` equals the result of the target operation, but no test runs `drop_matchmaker` with a `false` result. With `RealtimeCore` in the module list the only call is in `Playing`, where the result is `true` (client/godot/core/qa_core/tests/test_realtime.gd:40), and the other test call is without `RealtimeCore`, which stops before the target operation (client/godot/core/qa_core/tests/test_setup.gd:141). Run path: replacing `_result(command, RealtimeCoreDev.force_matchmaker_lost(), ...)` with a call that ignores the result and then `_ok(command)` fails no test, by reading of every `drop_matchmaker` use in client/godot/core/qa_core/tests/; this replacement was not run. Unrelated to the range: neither that line nor `force_matchmaker_lost` changed in it

## debt

none

## must fix

none

## unknown

- The range changes no file under client/godot/core/qa_core/. Read as in scope: the QACore code that calls the changed `RealtimeCore` (`drop_peer`, `drop_matchmaker`, `leave_match`, `set_step_mode`, `step`, input budget, the `match_state` and room fields of `QAState`), and `close` and `leave_room` of the DEV lockstep and sim transports. For `cancel_matching` of those transports, I only checked that it exists. The rest of QACore (channel, capture, telemetry, list_ui, debug screen, cheats) was not read, so it is neither passed nor failed by this review
- `ogw core test godot QACore` passed in the native run. I did not check whether that module result was run again or reused from the kept results. `ogw core test godot --web QACore` was not run
- The QACore tests use the fake realtime transport and the lockstep transport wrapping it. `drop_peer` and `drop_matchmaker` on the P2P transport with the changed `_poll_peer` were read (client/godot/core/realtime_core/dev/realtime_core_dev.gd:66, client/godot/core/realtime_core/p2p_peer.gd:85, client/godot/core/realtime_core/p2p_realtime_transport.gd) and not run
- The changes of the range under server/ and the settings minimums in settings/core-settings.schema.json were checked only as far as this: the changed files are outside the client module, and no changed settings key is a `QACore` key. The server code itself was not read
