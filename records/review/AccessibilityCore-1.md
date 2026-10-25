# review: AccessibilityCore round 1

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

- The commit range does not change `client/godot/core/accessibility_core/`. The changes in the range that AccessibilityCore reaches are those of `client/godot/core/screen_effect_core/screen_effect_core.gd` (new `time_basis` input of `fade`, `flash` and `play_preset`, its check in `_check_request`, and `_play` setting `_tween_options.time_basis`). Checked: AccessibilityCore calls only `ScreenEffectCore.set_flash_opacity_limit` (`client/godot/core/accessibility_core/accessibility_core.gd:392`), which the range does not change; `flash` still takes the smaller of `max_opacity` and `_flash_limit` as its peak; the default `time_basis` is `REAL_TIME`, the same as the `TweenOptions` default (`client/godot/core/tween_core/tween_options.gd:6`) that `_play` used before, so the 7-argument `flash` call of `client/godot/core/accessibility_core/tests/test_shake_flash.gd:95` plays as before. `UICore.is_flow_in_progress` and `TweenCore.get_finite_playing_count` are new read-only operations that AccessibilityCore does not call and that change no state it reads (`UICore.get_layer`). The `UnitTestCore` start signal (`PUT /started` before the first test) changes only the run start, not `advance_clock` or `wait_frames` that the AccessibilityCore tests use. The other changes in the range (AuthCore client tests, server auth, QACore and UnitTestCore settings keys, generated files) are not called by AccessibilityCore and do not call it
- `ogw core test godot AccessibilityCore` on this checkout passed (two passes reported `pass`)
- The browser run (`--web`) was not run
