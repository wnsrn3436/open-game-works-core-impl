# review UnitTestCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `_setup_test` (client/godot/core/unit_test_core/dev/unit_test_core.gd:645) and `_close_run` (:397) now call `_clear_pre_init_values` (:751) right after `BootstrapCoreDev.shutdown()`; it calls `TimeCore.release()` when TimeCore is not initialized, and `TimeCore._reset` (client/godot/core/time_core/time_core.gd:706-708) clears `_has_random_base`, `_random_base` and `_set_frame_step_fps`. The test clock that `_reset` also clears is registered again by `_register_replacements` (:654, and `_pop_run` :1196) before the next test, so test setup order (skills/client-core/modules/unit-test-core.md:45-51) is kept. New test client/godot/core/unit_test_core/tests/test_run.gd:19 with client/godot/core/unit_test_core/tests/resources/sample_time_pre_init.gd covers both the next test and the run end. `ogw core test godot UnitTestCore --file test_run.gd`: pass. In a temporary `git worktree add` of HEAD with the body of `_clear_pre_init_values` disabled (`if false:`), the same command fails: `test_time_core_values_from_before_init_do_not_stay_in_the_next_test_or_after_the_run` gets nested status `fail`, `[30] expected to equal [0]` (frame step) and a seed that differs from the device-time seed (random base) |

## out of scope

- client/godot/core/unit_test_core/dev/unit_test_core.gd:751: medium `_clear_pre_init_values` clears only TimeCore, but DataCore keeps the same kind of pre-init DEV value: `DataCoreDev.set_test_data_location` (client/godot/core/data_core/dev/data_core_dev.gd:7) sets `DataCore._builtin_location`, which only `DataCore.release` resets (client/godot/core/data_core/data_core.gd:73), and `BootstrapCore._release_entry` (client/godot/core/bootstrap_core/bootstrap_core.gd:1343) calls `release` only on initialized modules. A test that calls `set_test_data_location` and ends before `DataCore.init` leaves the location for the next test, against "A test does not depend on the results or the run order of other tests" (skills/client-core/modules/unit-test-core.md:41). This existed before the range; found from the code path, not run. The core agent report lists further modules of this kind (AuthCoreDev, GameUpdateCoreDev, NoticeCoreDev, ResourceCore, AccessibilityCore) that were not checked here

## debt

none

## must fix

none

## unknown

- The whole UnitTestCore suite was not run; only `test_run.gd` (pass on HEAD, fail with the fix disabled)
- Whether a test run started with a launch value file on its command line passes `OGW_RANDOM_BASE` or `OGW_FRAME_STEP_FPS` into the TimeCore of a test boot (`start_test_boot` is a dev run without build info; `BootstrapCoreDev.pass_time_launch_values`, client/godot/core/bootstrap_core/dev/bootstrap_core_dev.gd:103) was not checked against how `ogw core test` and regression runs start the engine
- The InputCore stick axis change in the range was not checked against the input injection of UnitTestCore
- Pre-init DEV values of modules other than TimeCore and DataCore were not checked
