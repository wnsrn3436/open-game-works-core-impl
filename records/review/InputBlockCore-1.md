# InputBlockCore review round 1

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

- The commit range 85f6b36d..c68ad396 changes no file under `client/godot/core/input_block_core/`, no `core-spec/InputBlockCore.json` and no `InputBlockCore.*` key of `client/godot/generated/core_settings.json` or `settings/core-settings.json`. Review covered the changes of the dependencies in that range and the callers of InputBlockCore that the range changed
- LogCore (`client/godot/core/log_core/log_core.gd`) changed only in comments in the range, so the error and warn logs of InputBlockCore are unchanged
- TimeCore (`client/godot/core/time_core/time_core.gd`) added the DEV frame step and `make_random_seed`. InputBlockCore reads only `TimeCore.get_real_time` (input_block_core.gd:264, :266, :456). Under a frame step, block elapsed time and forced release follow the stepped real elapsed time, which is what the spec's "real elapsed time of `TimeCore`" says. The InputBlockCore core tests use the test clock, and the time-core spec says a frame step changes no time value while a test clock is in use. `make_random_seed` is not used by InputBlockCore
- The frame step problems in TimeCore that this range reveals (`init` turns on the frame step from `--fixed-fps` or the Movie Maker fps without `set_frame_step`, and the DEV operation is named `set_test_frame_step` instead of `set_frame_step`) are already items D1 to D3 of `records/review-debt/TimeCore.json`, so they are not written in `## out of scope`
- Callers changed in the range: `client/godot/core/input_core/input_core.gd:968` calls only `InputBlockCore.is_blocked`, and the InputCore stick axis tests use the block helpers in the usual way. The QACore changes in the range (frame interval max, font weight, memory stats) do not call `InputBlockCore.set_timer_hold` or any other InputBlockCore operation
- `ogw core test godot InputBlockCore` passed (job mw7u8gqm176369). The core tests of the modules that depend on InputBlockCore were not run here, because `ogw review run` runs them
