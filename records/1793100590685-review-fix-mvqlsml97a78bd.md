# review fix: QACore round 1

## done

- QACore (Godot): added two core tests to `client/godot/core/qa_core/tests/test_telemetry.gd` for the release input behavior of telemetry. The implementation (`client/godot/core/qa_core/dev/qa_telemetry.gd`) is unchanged; both findings were missing test evidence, and the current implementation already matches the spec.

## spec proposals

none

## review

- R1-1: fixed. Added `test_a_release_input_is_not_in_input_count` (client/godot/core/qa_core/tests/test_telemetry.gd:102). It puts in `key_down`, `key_up`, `tap` between two `Goal` marks and asserts `goal_intervals.1.input_count` is 2. Mutation check: adding `_goal_inputs += 1` to `add_release` (qa_telemetry.gd:157) made this test fail with `[3] expected to equal [2]` (job mvqludd79adc18). The change was then reverted.
- R1-2: fixed. Added `test_a_release_input_ends_an_idle_span` (client/godot/core/qa_core/tests/test_telemetry.gd:168). It puts in `key_down`, advances `QACore.idleThresholdMs` + 1, puts in `key_up`, then asserts exactly one idle span, that its `end_at` is not null (no span still going on), that `end_at - start_at` is `idleThresholdMs` + 1, and that `duration_ms` is `idleThresholdMs` + 1. Mutation check: emptying the body of `add_release` made this test fail (job mvqlus0g105955). The change was then reverted.

## unverified

- `ogw core test godot QACore BootstrapCore UnitTestCore` (native) passed all 317 tests headless, but QACore came back `skipped` with exit code 1 because its render pass did not run: "the macOS screen is locked or the display sleeps". I cannot unlock the screen from here, so the native render pass of QACore was not run in this change. The last core test run, `ogw core test godot QACore BootstrapCore UnitTestCore --web`, passed 317/317 with exit code 0.
- As the review's `## unknown` says, the softlock count of release inputs (`qa_core.gd:826`) is outside these findings and was not checked against tests.
