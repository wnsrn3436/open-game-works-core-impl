# review TimeCore round 1

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | `_engine_frame_step_fps` and every read of `--fixed-fps` / the Movie Maker fps are gone (commit 279c6798). `init` sets `_frame_step_fps = _set_frame_step_fps` (client/godot/core/time_core/time_core.gd:108), and only `TimeCoreDev.set_frame_step` writes `_set_frame_step_fps` (client/godot/core/time_core/dev/time_core_dev.gd:131). So a DEV run started with `--fixed-fps 30` and no `set_frame_step` call has `_frame_step_fps` 0, and `_on_engine_frame` uses the monotonic difference (time_core.gd:410-414). client/godot/core/time_core/tests/test_frame_step.gd:95 checks that `get_frame_step_fps` is 0 after `release` and another `init` without `set_frame_step` |
| D2 | fixed | none | The DEV operation is now `TimeCoreDev.set_frame_step` (client/godot/core/time_core/dev/time_core_dev.gd:124), which matches the time-core.md `## DEV` table under the godot.md naming rule (spec DEV operation → `static func` of the same name in `<Module>Dev`). `BootstrapCoreDev` calls it with `OGW_FRAME_STEP_FPS` (client/godot/core/bootstrap_core/dev/bootstrap_core_dev.gd:109-111). No `.gd` or `.md` file in the checkout still has `set_test_frame_step` |
| D3 | fixed | none | Same cause as D1, removed in commit 279c6798: without a `set_frame_step` call before `init`, `_set_frame_step_fps` is 0 (set at time_core.gd:82 and cleared by `_reset`, time_core.gd:708), so `init` turns on no frame step and `get_frame_step_fps` is 0, as time-core.md `## DEV` requires |

## must fix

none

## unknown

- The commit range 625ae189..625ae189 is empty, so no change in a range could cause new findings. Only the input `## debt` items were checked: by reading `init`, `_on_engine_frame`, `_frame_step_increment` and `_reset` of client/godot/core/time_core/time_core.gd, `set_frame_step` / `get_frame_step_fps` of client/godot/core/time_core/dev/time_core_dev.gd, the `BootstrapCoreDev` caller, and test_frame_step.gd / test_lifecycle.gd
- Not run: `ogw core test godot TimeCore` was not run in this review, and no test was run against a copy with the defect restored. The debt results are from reading the code
- Not checked: a real dev run started with `--fixed-fps` or under the engine Movie Maker. No core test starts the engine at a fixed frame rate
