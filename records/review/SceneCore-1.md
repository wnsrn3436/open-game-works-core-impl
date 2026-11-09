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

- The commit range 625ae189..ec10a3ca changes no file under `client/godot/core/scene_core/` and no file of the modules SceneCore depends on (`log_core`, `event_core`, `time_core`, `resource_core`, `pool_core`, `safe_area_core`, `input_block_core`, `screen_effect_core`, `ui_core`, `message_core`). No SceneCore key changed in `client/godot/generated/core_settings.json`
- The only change that reaches SceneCore is the one in `client/godot/core/bootstrap_core/bootstrap_core.gd:1350`: `shutdown` now calls `release` also for modules that are not initialized. SceneCore is listed with `SceneCore.release` (`client/godot/generated/core_modules.gd:34`), and `SceneCore.release` returns at once when the module is not initialized (`client/godot/core/scene_core/scene_core.gd:140-142`). SceneCore keeps no value set before `init`: every static var is set by `init` (`client/godot/core/scene_core/scene_core.gd:85-138`) or by a transition, and an `init` that fails after `_is_initialized` is set calls `release` itself (`client/godot/core/scene_core/scene_core.gd:129-137`). So the new call changes nothing for SceneCore. The removal of `_clear_pre_init_values` in `client/godot/core/unit_test_core/dev/unit_test_core.gd` is covered by the same `shutdown` change for `TimeCore`, which SceneCore reads only through `TimeCore.get_real_time`
- `ogw core test godot SceneCore BootstrapCore` passed (no test record: the checkout had the uncommitted deletion of this review file)
- SceneCore code that the range does not reach was not audited again for problems that existed before the range, so `## out of scope` covers only what was read for the checks above
