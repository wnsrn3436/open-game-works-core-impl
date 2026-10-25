# review QACore round 3

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The previous review (round 2) has no `## findings` rows and no `open` rows in `## previous`, so step 5 has nothing to judge. No defect restore was run
- The only code change in this range is in tests. The `QACore.captureJpgQuality` range check moved from `client/godot/core/qa_core/tests/test_render_capture.gd` (`test_capture_formats`) to `client/godot/core/qa_core/tests/test_lifecycle.gd:31` (`test_capture_jpg_quality_out_of_range_fails_init`), which runs in the headless pass. It was checked by reading the code. `start(false)` (`tests/support/qa_test_case.gd:143`) inits the dependencies but not QACore. For 9 and 1001, `_read_settings` (`dev/qa_core.gd:1070`-`1084`) logs one error and `init` returns `false` before it changes any state. `errors()` (`qa_test_case.gd:250`) uses `UnitTestCore.check_logs`, so each loop pass counts only its own error. For 10 and 1000 the test sets `_has_test_launch_values` again before each `init`, because `release` clears it (`dev/qa_core.gd:294`), so no automation channel connects. If `_MIN_JPG_QUALITY` went back to 1, quality 9 would init and the `assert_false` would fail. If the over-1000 check were removed, quality 1001 would init and the test would also fail. The Godot core tests were not run in this review. The core agent report says the headless pass of its proof run fails on `bfcaf51` with these test files, with `quality 9 fails init`
- The native render pass (`test_render_capture.gd`, which now has no range loop) was not run in this review. The core agent report says its host's screen was locked and that only the `--web` run passed it
- The other files changed in this range (`records/` run log, report and the round 2 review file) are process records and were not reviewed
