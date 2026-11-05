# review QACore round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | client/godot/core/qa_core/tests/test_realtime.gd:46 `test_drop_matchmaker_outside_playing` runs `drop_matchmaker` with `RealtimeCore` started and the match in `None`, and asserts `ok` is `false`, the result text `force_matchmaker_lost failed`, no `force_close_matchmaker` call, one `RealtimeCore` warn and one QACore warn. Restored defect: in a copy of client/godot outside the checkout (scratchpad), client/godot/core/qa_core/dev/qa_builtins.gd:297 `_result(command, RealtimeCoreDev.force_matchmaker_lost(), "force_matchmaker_lost failed")` was replaced with `RealtimeCoreDev.force_matchmaker_lost()` then `_ok(command)`, and test_realtime.gd was run alone through the harness GUT runner (`gutRun` with `gutFileArgs('res://core/qa_core/tests/test_realtime.gd')`, Godot 4.7.2, headless) with the copy as the project. Result 11/12: `test_drop_matchmaker_outside_playing` failed at the `ok` assert, the result text assert (`<not a string>` vs `force_matchmaker_lost failed`) and the QACore warn count (0 vs 1). An unmutated control copy run the same way passed 12/12, so the runs tested the copies |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | The `false` result of `force_matchmaker_lost` through `drop_matchmaker` is now checked by client/godot/core/qa_core/tests/test_realtime.gd:46, and the `true` result by test_realtime.gd:40. The mutation of D2 (ignore the result, then `_ok`) fails that test; see R3-1 in `## previous` |

## must fix

none

## unknown

- The range changed only client/godot/core/qa_core/tests/test_realtime.gd among QACore files. The other changes of the range (PaymentCore, MessageCore tests, server modules, records) are outside QACore, and QACore code does not call PaymentCore; MessageCore is only initialized by the QACore test setup, and its change in the range is tests only
- `ogw core test godot QACore --file client/godot/core/qa_core/tests/test_realtime.gd` passed in this checkout. The full QACore suite and its render pass were not run in this round
- The two unknown items of round 1 (button mask of a release while another command holds a mouse button; a debug screen command that times out before an automation channel drop) were not rechecked
