# ScreenEffectCore review round 1

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

- The commit range 625ae189..32b266a0 changes no file of `client/godot/core/screen_effect_core/` and no file of the modules it depends on (`LogCore`, `EventCore`, `TweenCore`, `ResolutionCore`, `UICore`); `## spec changes` is `none`. The review covered the changes of the range that reach ScreenEffectCore: `client/godot/core/bootstrap_core/bootstrap_core.gd:1347` (`shutdown` now calls `release` also for a module that is not initialized) and the removal of `_clear_pre_init_values` in `client/godot/core/unit_test_core/dev/unit_test_core.gd`. `ScreenEffectCore.release` (`client/godot/core/screen_effect_core/screen_effect_core.gd:68`) returns at once when not initialized, and ScreenEffectCore keeps no value set before `init` (every setter, `set_flash_opacity_limit` and `ScreenEffectCoreDev.set_world_skip`, refuses before `init`), so the new call is safe. `ogw core test godot ScreenEffectCore` passed on this checkout
- Code of ScreenEffectCore that the range does not change or reach was not reviewed again, as the commit range limits the findings to the problems the changes cause or reveal
