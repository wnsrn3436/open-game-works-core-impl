# review: SceneCore round 1

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

- The commit range 85f6b36d..0eb90a85 changes no file under `client/godot/core/scene_core/`. Of the modules SceneCore depends on, only `client/godot/core/log_core/log_core.gd` (comments only) and `client/godot/core/time_core/time_core.gd` with `client/godot/core/time_core/dev/time_core_dev.gd` (random seed, DEV random base, DEV frame step) changed. SceneCore reads only `TimeCore.get_real_time` (`client/godot/core/scene_core/scene_core.gd:228`, `:400`, `:418`, `:451`, `:754`). The frame step changes the real increment only when no test clock is set (`client/godot/core/time_core/time_core.gd:412-425`), and the core node of TimeCore still processes before the SceneCore frame check, so the minimum display wait and `duration_ms` keep reading real elapsed time; no SceneCore key changed in `client/godot/generated/core_settings.json`. `ogw core test godot SceneCore` passed (no test record: the checkout had the uncommitted deletion of this review file)
- SceneCore code that the range does not reach (the whole module outside the TimeCore calls above) was not audited again for problems that existed before the range, so `## out of scope` covers only what was read for the checks above
- Not run under the frame step (`--fixed-fps` or Movie Maker): no SceneCore test sets `TimeCoreDev.set_test_frame_step`, so the minimum display wait under the frame step was checked only by reading the code
