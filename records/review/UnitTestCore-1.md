# review UnitTestCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | client/godot/core/unit_test_core/dev/unit_test_core.gd:643 | The range added TimeCore DEV values that are set before `init` and kept until `release` (`_has_random_base`/`_random_base`, `_test_frame_step_fps` of client/godot/core/time_core/time_core.gd:82-87, set by `TimeCoreDev.set_random_base` and `set_test_frame_step`; cleared only in `TimeCore._reset`). Test setup `_setup_test` releases modules only through `BootstrapCoreDev.shutdown()`, whose `_release_entry` (client/godot/core/bootstrap_core/bootstrap_core.gd:1322) calls `release` only when `is_initialized` is true, and `_register_replacements` (unit_test_core.gd:745) resets only the test clock, so a value set by a test that never reached `TimeCore.init` (e.g. a test that fails or returns before its init) stays in the next test. This breaks `A test does not depend on the results or the run order of other tests` and the fresh state of `### test setup` (skills/client-core/modules/unit-test-core.md:41-51). Reproduced in a temporary worktree of HEAD with a file `client/godot/core/unit_test_core/tests/test_zz_leak.gd` extending `UnitTestCase`: test 1 calls `TimeCoreDev.set_random_base(42)` and `TimeCoreDev.set_test_frame_step(30)` without init; test 2 inits LogCore, EventCore, TimeCore, sets device time 1700000000000 and gets `get_frame_step_fps()` 30 (expected 0) and `make_random_seed("a")` = `make_purpose_seed("a", 42)` instead of `make_purpose_seed("a", 1700000000000)` (`ogw core test godot UnitTestCore --file test_zz_leak.gd`: fail). TimeCore's own tests hide it because their `after_each` calls `TimeCore.release()` unconditionally | In test setup (and `_close_run`) also clear the values TimeCore keeps from before `init` when TimeCore is not initialized after `BootstrapCoreDev.shutdown()` (e.g. call `TimeCore.release()`, which runs `_reset`), and add a core test of two consecutive tests where the first sets a random base and a frame step without `init` and the second sees none | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Changed UnitTestCore code in the range is only the fake realtime transport `close(forfeit)` (client/godot/core/unit_test_core/dev/unit_test_realtime_transport.gd:46) and its test (client/godot/core/unit_test_core/tests/test_realtime.gd:40-50). It matches `close` (forfeit flag) of skills/client-core/modules/realtime-core.md:81 and the recording rule of unit-test-core.md:68; the test asserts the recorded `close` and its input `true`. `ogw core test godot UnitTestCore --file test_realtime.gd` passed (headless and render). The whole UnitTestCore suite was not run
- Of the code UnitTestCore calls that changed in the range (TimeCore, InputCore, LogCore, RealtimeCore), only the TimeCore pre-init DEV values and the RealtimeCore transport interface were checked against UnitTestCore; the InputCore stick axis inversion and sensitivity change was not checked against the real input injection of UnitTestCore
- Whether other modules keep DEV values set before `init` that test setup does not clear was not checked outside TimeCore
