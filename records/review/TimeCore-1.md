# review TimeCore round 1

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

- Checked in the range: `make_random_seed` (per-purpose count, random base or device time, snake_case failure not counted, error log before `init`), `_add_int64` (64-bit wrap in 32-bit halves, including int64 max + 1 and int64 min − 1), `TimeCoreDev.set_random_base` / `set_frame_step` / `get_frame_step_fps` (before-init only per core/SKILL.md `init` rules, fps < 1 ignored with an `error` log), the frame step increment in `_on_engine_frame` (n-th frame ⌊n·1000/f⌋ − ⌊(n−1)·1000/f⌋, not applied while a test clock is in use, passed through time scale, pause, carry and step mode by `_game_increment`), `_reset` clearing the random base, frame step and seed counts, and the callers `BootstrapCoreDev.pass_time_launch_values` (called in `InitModules` 2 before module `init` of every boot) and `UnitTestCore._clear_pre_init_values`. Each `## test` item of time-core.md about random seed and frame step has a test in client/godot/core/time_core/tests/test_random_seed.gd, test_frame_step.gd and test_lifecycle.gd. `ogw core test godot TimeCore` (without `--web`) passed on 05283fbf
- Not checked: a real dev run under the engine movie maker with `OGW_FRAME_STEP_FPS`, and a game's DEV export with `OGW_RANDOM_BASE`; no core test starts the engine at a fixed frame rate
- Not checked: whether `UnitTestCore._clear_pre_init_values` at the end of a nested run (client/godot/core/unit_test_core/dev/unit_test_core.gd:397) leaves the outer test without its TimeCore test clock when the outer test has not initialized TimeCore. That is UnitTestCore code, outside this target; its fix report says `_pop_run` registers the outer clock again
- Not run with a restored defect: the mutation sensitivity of the frame step tests was judged by reading (e.g. `probe.real_time[0] == 16` fails without the frame step, `get_real_frame_ms() >= 40` fails if `release` kept it), not by running a modified copy
