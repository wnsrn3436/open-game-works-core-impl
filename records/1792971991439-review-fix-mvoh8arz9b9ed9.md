# review fix: QACore round 1

## done

- No code change in this job. The fix that R1-1 asks for is already on main HEAD (`dd8a6e8`) through commit `264f0c6` (`update core` job `mvoh0iild7a450`), which the review range did not include
- `ogw core test godot QACore BootstrapCore UnitTestCore` (QACore and `ogw core dependents QACore`): 313 tests, 313 passed; the QACore render pass was not run (screen locked)
- `ogw core test godot QACore BootstrapCore UnitTestCore --web`: 313 tests, 313 passed. The web run takes every `test_` script, so `test_render_capture.gd` ran
- `ogw code check core`: pass

## spec proposals

none

## review

- R1-1: fixed (in `264f0c6`, checked in this job)
  - `settings/core-settings.schema.json:1752`: `QACore.captureJpgQuality` `minimum` is 10 (`maximum` 1000)
  - `client/godot/core/qa_core/dev/qa_core.gd:65`: `_MIN_JPG_QUALITY` = 10, which `_read_settings` (`qa_core.gd:1074`) uses as the least value, so 1 to 9 fail `init` like 1001 does
  - test: `client/godot/core/qa_core/tests/test_render_capture.gd` `test_capture_formats`: quality 9 and quality 1001 each make `QACore.init` return `false`, leave QACore uninitialized and log one error. Passed in the `--web` run

## unverified

- The native Godot render pass of QACore (`test_render_*`, including `test_capture_formats`) was not run in this job: the macOS screen was locked or the display was asleep (`render pass not run`). Commit `264f0c6` reports that it passed natively when it was made
