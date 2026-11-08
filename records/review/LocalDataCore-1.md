# review LocalDataCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/time_core/time_core.gd:113: medium TimeCore `init` also turns on the frame step in a DEV build without `set_frame_step`, from `--fixed-fps <n>` in the engine arguments or from the Movie Maker fps when the movie path is not empty (`_engine_frame_step_fps`, time_core.gd:442). The time-core spec `## DEV` says TimeCore is at a frame step only "when `set_frame_step`(f) was called before `init`", and that the runner passes f. Run path: a DEV build started with `--fixed-fps 30` and no `set_frame_step` call has `get_frame_step_fps` 30 and real frame increases of 33/34 ms, where the spec gives 0 and the monotonic difference
- client/godot/core/time_core/dev/time_core_dev.gd:124: medium The DEV operation is named `TimeCoreDev.set_test_frame_step`, but the time-core spec `## DEV` table and bootstrap-core.md (`OGW_FRAME_STEP_FPS`, `InitModules` 2) name it `TimeCore.set_frame_step`. No `client/godot` code outside time_core calls either name, so `OGW_FRAME_STEP_FPS` has no caller that sets the frame step under the name the defining documents give

## debt

none

## must fix

none

## unknown

- LocalDataCore code and tests (`client/godot/core/local_data_core/`) did not change in the commit range. In the range its dependencies changed: TimeCore (`make_random_seed`, random base, frame step) and LogCore (comments only). UtilCore and EventCore did not change. LocalDataCore reads only `TimeCore.is_initialized` and `TimeCore.get_real_time` (local_data_core.gd:600, :611-613) for the write wait. With a frame step, `get_real_time` grows by the stepped increase. The time-core spec says real elapsed time follows the frame step, and LocalDataCore says the wait is in real elapsed time, so the write wait counts stepped time as the definitions say. With a test clock, the frame step changes no time value (time_core.gd:411-416), so the LocalDataCore tests that use `UnitTestCore.advance_clock` are not affected
- `ogw core test godot LocalDataCore` passed (job mw7tt411058fdd). The web runtime (`--web`, IndexedDB save) was not run, because the range does not change code that it reaches
- Problems in LocalDataCore from before the range and unrelated to its changes were not looked for, because the commit range is not `none`
