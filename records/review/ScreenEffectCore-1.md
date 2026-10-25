# review ScreenEffectCore round 1

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

- No file under `client/godot/core/screen_effect_core/` changed in the range `2ef5ae8d..79a88f40`, and no definition changed (`## spec changes` is `none`). Of the modules ScreenEffectCore depends on (`LogCore`, `EventCore`, `TweenCore`, `ResolutionCore`, `UICore`), only `client/godot/core/tween_core/tween_core.gd` and `client/godot/core/tween_core/change_state.gd` changed. The change adds arranged-element handling (`_is_arranged`, `ChangeState.arranged`, `_write_offset`) that applies only when `property <= TweenProperty.SCALE` (`client/godot/core/tween_core/tween_core.gd:1028`, `:1068`; enum at `:6`). ScreenEffectCore plays only `Opacity` steps (`client/godot/core/screen_effect_core/screen_effect_core.gd:388`), and `_check_preset` rejects any property other than `Color` and `Opacity` (`screen_effect_core.gd:473`). So overlay reads and writes still go through the unchanged `Color`/`Opacity` paths of `_read`/`_write`. The rewritten start logic in `_set_step_values` (`tween_core.gd:644-652`) reads the start value under the same conditions as before (not started, not finishing, `local < duration`), so overlay fades, flashes and presets get the same start value as before
- I did not run the ScreenEffectCore Godot tests (`client/godot/core/screen_effect_core/tests/`) in this round. The conclusion above comes only from reading the code
- The other files changed in the range (`auth_core`, `bootstrap_core`, `sound_core`, generated contract and settings, server modules) neither call ScreenEffectCore nor are called by it, so I did not check them
