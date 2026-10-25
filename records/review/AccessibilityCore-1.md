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

- The commit range does not change `client/godot/core/accessibility_core/`. The changes in the range that AccessibilityCore reaches are those of `client/godot/core/sound_core/sound_core.gd` (Sfx pitch and volume variation, play end at length ÷ pitch scale, Bgm voice duck), which `AccessibilityCore.play_voice` (`client/godot/core/accessibility_core/accessibility_core.gd:239`) and the subtitle frame check (`client/godot/core/accessibility_core/accessibility_core.gd:479`) call through `SoundCore.play` and `SoundCore.is_playing`. Checked: the variation is applied only when the bus is `Sfx` (`client/godot/core/sound_core/sound_core.gd:840`), so `Voice` plays keep pitch scale 1 and the end time that hides the subtitle is unchanged; the duck changes only the `Bgm` bus effect; `is_playing` → `_free_slot` → `_sync_duck` allocates nothing and does not change the handle result. The other changes in the range (TweenCore, AuthCore, BootstrapCore ban popup arguments, generated contract, server modules) are not called by AccessibilityCore and do not call it; `BootstrapCore` still calls `apply_saved_settings` after `LocalDataCore.load_device_file` (`client/godot/core/bootstrap_core/bootstrap_core.gd:317`, `client/godot/core/bootstrap_core/bootstrap_core.gd:354`)
- `ogw core test godot AccessibilityCore` on this checkout: the headless pass did not fail, and the result was `skipped` because the render pass was not run (the macOS screen is locked or the display sleeps). So `tests/test_render_color_filter.gd` (filtered pixel colors, filtered loading icon) was not run against the code of this range
- The browser run (`--web`) was not run
