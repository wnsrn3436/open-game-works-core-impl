# QACore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/qa_core/tests/test_telemetry.gd:82 | The range makes release inputs leave `input_count` of `goal_intervals`: `add_release` (client/godot/core/qa_core/dev/qa_telemetry.gd:157) does not add to `_goal_inputs`, while the old path `add_input` did (qa_telemetry.gd:149). The spec `## test` item "the number of inputs that are not release inputs between two `Goal`s is `input_count` of `goal_intervals`" (open-game-works-core/skills/client-core/modules/qa-core.md:382) has no test with a release input: `test_marks_and_goal_intervals` puts in only `tap_empty` between the `Goal` marks, and the only test in the module that sends a release command and reads telemetry (`test_a_release_input_is_not_recorded`, test_telemetry.gd:41) has no `Goal` mark. Restoring the defect by adding `_goal_inputs += 1` to `add_release` (or routing `key_up` back to `add_input`'s goal count) changes no asserted value in any test of client/godot/core/qa_core/tests (checked by grep: `goal_intervals` is read only at test_telemetry.gd:97-99, 116-118, 180, 213-214, and those tests send no release command) | Add a test that puts in e.g. `key_down`, `key_up`, `tap` between two `Goal` marks and asserts `input_count` is 2 (the `key_up` not counted) | no | 90 |
| R1-2 | test evidence | medium | client/godot/core/qa_core/dev/qa_telemetry.gd:157 | The new `add_release` keeps a release input as activity for `idle_spans` (spec open-game-works-core/skills/client-core/modules/qa-core.md:212: "It is an input for `idle_spans` and the softlock judgement") by calling `_activity`. No test covers it: `test_a_release_input_is_not_recorded` (test_telemetry.gd:41-52) advances only 30 ms and 20 ms with `QACore.idleThresholdMs` 1000 (client/godot/core/qa_core/tests/support/qa_test_case.gd:39), and `test_idle_span` (test_telemetry.gd:140) uses only `tap_empty`. Emptying the body of `add_release` (so a release input no longer closes an idle span) changes no asserted value in any test of the module | Add a test: `key_down`, advance `QACore.idleThresholdMs` + 1, `key_up`, then assert one closed idle span ending at the `key_up` and no span still going on | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The Godot tests were not run in this round (no `ogw core test` run, no temporary copy run). R1-1 and R1-2 were decided by reading every test file under client/godot/core/qa_core/tests for reads of `goal_intervals` and `idle_spans` and for release commands (`touch_up`, `key_up`, `mouse_up`, `pad_button_up`) combined with telemetry reads
- The other changes of the range (client/godot/plugins/ogw-secure-storage/, client/godot/engine.json plugin entry without `url` and `sha256`, auth_core tests, server core, settings) are outside QACore and were not checked
- The softlock count of release inputs (`_inputs_since_state += 1` at client/godot/core/qa_core/dev/qa_core.gd:826) is unchanged by this range and was not checked against tests
