# review QACore round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | test evidence | medium | client/godot/core/qa_core/dev/qa_builtins.gd:297 | Debt D2 remains. `## test` of the QACore spec (`skills/client-core/modules/qa-core.md:343`) requires that `ok` of `drop_matchmaker` equals the result of `RealtimeCore.force_matchmaker_lost`, which returns `false` outside `Playing` (client/godot/core/realtime_core/dev/realtime_core_dev.gd:26). The only test uses of `drop_matchmaker` are `run_ok("drop_matchmaker")` in `Playing` (client/godot/core/qa_core/tests/test_realtime.gd:40, result `true`) and the call without `RealtimeCore` (client/godot/core/qa_core/tests/test_setup.gd:142), which fails in `_need_module` before the target operation. No test runs `drop_matchmaker` with `RealtimeCore` in the module list outside `Playing`. Run path: replacing `_result(command, RealtimeCoreDev.force_matchmaker_lost(), ...)` with `RealtimeCoreDev.force_matchmaker_lost(); _ok(command)` leaves every assert that reads `drop_matchmaker` unchanged in outcome, by reading of every use in client/godot/core/qa_core/tests/ (the mutation run could not be done; see `## unknown`) | In test_realtime.gd, run `drop_matchmaker` with `RealtimeCore` started but the match not `Playing` (e.g. after `start_realtime()` in `None`, or after the matchmaker is already lost) and assert `ok` is `false`, `force_close_matchmaker` was not called, and the failure text | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | open | R3-1 | client/godot/core/qa_core/dev/qa_builtins.gd:295-297 and the `drop_matchmaker` uses in client/godot/core/qa_core/tests/test_realtime.gd:40 and client/godot/core/qa_core/tests/test_setup.gd:142 are unchanged; no test checks a `false` result of `force_matchmaker_lost` through `drop_matchmaker` |

## must fix

none

## unknown

- The commit range is empty (`1b8ce0f..1b8ce0f`), so no code changed in it; this round checked only debt D2. Round 2 had no findings and no `open` rows in `## previous`, so `## previous` has no rows
- The R3-1 mutation was not run. A mutated copy of the checkout in a temporary folder was tested with `ogw core test godot QACore --file client/godot/core/qa_core/tests/test_realtime.gd`, but the tool did not test the copy: a control mutation in the copy (`size(), 1` changed to `size(), 7` at test_realtime.gd:41) also passed. R3-1 rests on reading every `drop_matchmaker` use in the tests
- The two unknown items of round 1 (button mask of a release while another command holds a mouse button; a debug screen command that times out before an automation channel drop) were not rechecked
