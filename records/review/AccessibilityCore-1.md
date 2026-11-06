# review AccessibilityCore round 1

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

- No file of `client/godot/core/accessibility_core/` changes in de482eec..9069447b. The review covered the changed code that AccessibilityCore calls: `SoundCore.play` play skip and DEV mute (`client/godot/core/sound_core/sound_core.gd:372`, `client/godot/core/sound_core/sound_core.gd:866`), `CameraCore.shake` shake skip (`client/godot/core/camera_core/camera_core.gd:402`) and the `ScreenEffectCore` World skip (`client/godot/core/screen_effect_core/screen_effect_core.gd:102`, `client/godot/core/screen_effect_core/screen_effect_core.gd:138`), against `play_voice` (`client/godot/core/accessibility_core/accessibility_core.gd:238`), the subtitle frame check (`client/godot/core/accessibility_core/accessibility_core.gd:486`), `_apply_reduce_shake` and `_apply_reduce_flash` (`client/godot/core/accessibility_core/accessibility_core.gd:395`). Play skip returns the invalid handle, so `play_voice` shows no subtitle, as the subtitles rules of the spec require for a request whose playback did not start. DEV mute keeps the handle playing, so the subtitle stays until the playback ends. Shake skip and World skip change neither the shake scale nor the flash opacity limit that AccessibilityCore sets, and each is turned off by the `release` of its module
- The AccessibilityCore core tests were not run in this review. The core agent reports in `records/` of this range say `ogw core test godot` with AccessibilityCore passed on their commits
- Code of AccessibilityCore outside the paths named above was read only for how it uses these dependencies, not checked in full against every spec item
