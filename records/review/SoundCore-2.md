# review SoundCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/sound_core/tests/test_dev_feedback.gd:112-117` now calls `play` with a `null` scope and with a released `PANEL` scope while play skip is on, and asserts `INVALID_HANDLE` and one SoundCore error log each. Restored the defect in a temporary detached worktree of `ad5d17bb` (removed after the run) by moving `if _play_skip: return INVALID_HANDLE` above the `scope == null or scope.released` check in `client/godot/core/sound_core/sound_core.gd:369-373`; `ogw core test godot SoundCore --file client/godot/core/sound_core/tests/test_dev_feedback.gd` failed on `test_play_skip_returns_the_invalid_handle_without_load_log_or_event_and_keeps_earlier_plays` with `[0] expected to equal [1]: the scope check still logs for a missing scope; [0] expected to equal [1]: the scope check still logs for a released scope`. The same file passes on the unmodified checkout |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `client/godot/core/sound_core/tests/test_dev_feedback.gd` was run (native headless, `--file`). The whole SoundCore suite and the `--web` run were not run in this review: the range changes only that test file in SoundCore, and `ogw review run` runs the core tests of the dependent modules
- The other changes in the range (`client/godot/core/qa_core/`, `client/godot/core/tween_core/`, `records/`) are outside the target. They were searched for references to SoundCore and contain none
