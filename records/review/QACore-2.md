# review QACore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `settings/core-settings.schema.json:1752` now has `"minimum": 10` (`maximum` 1000). `client/godot/core/qa_core/dev/qa_core.gd:65` defines `_MIN_JPG_QUALITY` = 10, and `_read_settings` (`qa_core.gd:1074`) uses it as the least value of `_KEY_CAPTURE_JPG_QUALITY`. So 1 to 9 log an error and make `init` return `false`, the same as values over 1000 (`qa_core.gd:1081`). `client/godot/core/qa_core/tests/test_render_capture.gd:82-88` sets quality 9 and 1001 and asserts for each that `init` returns `false`, that QACore is not initialized and that one error is logged. `UnitTestCore.check_logs` marks the logs it counts as checked (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1297-1300`), so each loop pass counts only its own error. With the old least value 1, quality 9 passes init and the `assert_false` fails, so the test catches the defect |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The Godot tests (`ogw core test`) were not run in this review. The claim that the test fails on the old code comes from reading the code, not from restoring the defect and running the test. R1-1 is a `spec` finding, so step 5 does not require a restore run
- The core agent report says the native render pass (`test_render_*`) was not run in its job because the screen was locked. It names only the `--web` run as the pass for `test_capture_formats`
- The other changes in this range (the `records/` files and the UnitTestCore review records) belong to other targets or are process records, and were not reviewed
