# QACore review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/qa_core/tests/test_telemetry.gd:102` (`test_a_release_input_is_not_in_input_count`) puts `key_down`, `key_up`, `tap` between two `Goal` marks and asserts `goal_intervals.1.input_count` is 2. Restored the defect in a temporary detached worktree of a866485 outside the checkout: added `_goal_inputs += 1` after `_activity(now())` in `add_release` (`client/godot/core/qa_core/dev/qa_telemetry.gd:157`). `ogw core test godot QACore --file client/godot/core/qa_core/tests/test_telemetry.gd` there: QACore fail, only `test_a_release_input_is_not_in_input_count` failed with `[3] expected to equal [2]: the key_up is not counted`. The same run on the unmodified copy: QACore pass |
| R1-2 | fixed | `client/godot/core/qa_core/tests/test_telemetry.gd:168` (`test_a_release_input_ends_an_idle_span`) puts `key_down`, advances `IDLE_THRESHOLD_MS + 1`, puts `key_up`, and asserts one idle span with a non-null `end_at` and `duration_ms` `IDLE_THRESHOLD_MS + 1`. Restored the defect in a second temporary detached worktree of a866485: replaced the body of `add_release` (`qa_telemetry.gd:158`) with `pass`. The same `--file` run there: QACore fail, only `test_a_release_input_ends_an_idle_span` failed (`the key_up ends the span`; `[-1700000999999] expected to equal [1001]`; `[-999999] expected to equal [1001]`) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The QACore change in the range is only the two tests above in `client/godot/core/qa_core/tests/test_telemetry.gd`; the implementation is unchanged. The other changes of the range (`server/core/storage/`, `server/core/routing/tests/`, `records/`) are outside QACore and were not checked
- The mutation and control runs were the native headless pass of `ogw core test godot QACore --file` only (a `--file` run does not run the browser run). The full module suite and `--web` were not run in this round
- The softlock count of release inputs (`_inputs_since_state += 1` at `client/godot/core/qa_core/dev/qa_core.gd:826`) is unchanged by this range and was not checked against tests
