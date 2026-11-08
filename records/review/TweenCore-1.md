# review TweenCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/time_core/dev/time_core_dev.gd:124: medium The DEV operation is named `set_test_frame_step`, while the TimeCore spec `## DEV` (`open-game-works-core/skills/client-core/modules/time-core.md:169`, 174, 177), BootstrapCore (`open-game-works-core/skills/client-core/modules/bootstrap-core.md:222`) and QACore (`open-game-works-core/skills/client-core/modules/qa-core.md:432`) name it `TimeCore.set_frame_step`. A caller written from the spec (BootstrapCore `InitModules` 2 with `OGW_FRAME_STEP_FPS`) calls a function that does not exist. `grep -rn set_frame_step client/` finds no `set_frame_step` definition, only `set_test_frame_step` and its tests (`client/godot/core/time_core/tests/test_frame_step.gd:14`, `client/godot/core/time_core/tests/test_lifecycle.gd:131`)
- client/godot/core/time_core/time_core.gd:113: medium When `set_test_frame_step` was not called and the build has DEV code, `init` turns on a frame step from the engine arguments `--fixed-fps <n>` or from the Movie Maker fps when the movie path is not empty (`_engine_frame_step_fps`, client/godot/core/time_core/time_core.gd:442). The TimeCore spec (`open-game-works-core/skills/client-core/modules/time-core.md:174`) puts TimeCore at a frame step only when `set_frame_step`(f) was called before `init`, and line 217 of it says that without `set_frame_step` `get_frame_step_fps` is 0 and the real frame increase is the monotonic time difference. Run path: a DEV dev run started with `--fixed-fps 30` and no `OGW_FRAME_STEP_FPS` gets `get_frame_step_fps` 30 and 33/34 ms real frame increases instead of the monotonic difference

## debt

none

## must fix

none

## unknown

- The commit range 85f6b36d..a4d0b44c changes no file of `client/godot/core/tween_core/`, no TweenCore spec line (`## spec changes` is none) and no `TweenCore.*` settings key. The dependency changes in the range that TweenCore reaches are TimeCore (frame step in `_on_engine_frame`, `make_random_seed`, `_add_int64`, DEV `set_random_base` and frame step) and comments of LogCore. TweenCore reads only `TimeCore.get_real_time` and `TimeCore.get_game_time` in `TweenCore._on_frame` and `_now` (client/godot/core/tween_core/tween_core.gd:645, 1296), which keep accumulating the frame increase, so the frame step gives tweens fixed per-frame increments and changes no TweenCore rule; TweenCore uses no random seed. EventCore, ResourceCore, PoolCore and InputBlockCore have no change in the range
- `ogw core test godot TweenCore TimeCore` passed (job mw7twx1h27ab3e). No TweenCore test runs at a TimeCore frame step; the spec sets none
- Code of TweenCore that the range does not reach was not reviewed again in this round
