# review: UICore round 1

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

- The commit range `2ef5ae8..de8d7d6` changes no UICore file. Among the modules UICore depends on, it changes `SoundCore` (`client/godot/core/sound_core/sound_core.gd`: `Sfx` pitch and volume variation, voice duck of `Bgm`, five new core settings) and `TweenCore` (`client/godot/core/tween_core/tween_core.gd`, `change_state.gd`: `Position`, `Rotation` and `Scale` of an arranged element go to its offset transform). The review covered the places where UICore reaches the changed code:
  - UICore plays open and close tweens only on panel and popup prefab roots (`client/godot/core/ui_core/ui_core.gd:531`, `:569`, `:1251`, `:1305`, `:1593`). Their parents are `_panel_root` and `_popup_root` (`SafeAreaRoot`, which extends `Control`, `client/godot/core/safe_area_core/safe_area_root.gd:2`) and `_system_root` (a plain `Control`, `ui_core.gd:886`), set at `ui_core.gd:526`, `:1373` and `:1475`. None is a `Container`, so `TweenCore._is_arranged` is false for every UICore tween target and the tween writes the same properties as before the range. The keyboard shift writes `position.y` of the same roots (`ui_core.gd:2763`), so it does not mix with offset transforms.
  - UICore plays its button sound only on `SoundBus.UI` (`ui_core.gd:2100`). The new variation applies only to `SoundBus.SFX` (`sound_core.gd` `_start_sfx`) and the duck changes only an effect of the `Bgm` bus, so UI sound plays, their end time and `SoundPlayedEvent` are unchanged.
  - `SoundCore.init` now fails without the five new settings. `client/godot/core/ui_core/tests/support/ui_test_case.gd:160` calls `SoundCore.init()` with the generated core settings, which hold them (`client/godot/generated/core_settings.json:476-480`). UICore tests set no settings override that drops them.
- The UICore core tests were not run in this review.
- The `SoundCore` and `TweenCore` changes themselves were not reviewed against their specs beyond what UICore reaches; that is the scope of the reviews of those modules.
