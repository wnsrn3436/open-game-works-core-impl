# review QACore round 1

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

- The commit range changes no QACore code or test (`client/godot/core/qa_core/` has no change). The one QACore change is `core-spec/QACore.json:153`, which adds the game settings item `uiQuality` (`object`, `game`, `none`). This matches the `## settings` table of `client-core/modules/qa-core.md`. `uiQuality` is read only by the UI quality check tool, which applies its conditions to the `list_ui` and `capture_screen` results. QACore defines no behavior that reads it, so `QACore._read_settings` (`client/godot/core/qa_core/dev/qa_core.gd:1029`) not checking it does not differ from the spec. The generated `client/godot/generated/core_settings.json:537` holds its default
- Changes in modules QACore depends on, checked against QACore use:
  - `AuthCore` now has `public_code` and `get_public_code` (`client/godot/core/auth_core/auth_core.gd:803`). QAState `user_id` still reads `AuthCore.get_user_id` behind `AuthCore.is_logged_in` (`client/godot/core/qa_core/dev/qa_query.gd:44`), and that operation is unchanged
  - The `BootstrapCore` ban popup now uses the format argument `public_code` (`client/godot/core/bootstrap_core/bootstrap_core.gd:966`). QACore calls only `get_build_info`, `boot_stage` and `get_launch_value`, which are unchanged
  - `SoundCore` adds sfx pitch and volume variation and voice ducking (`client/godot/core/sound_core/sound_core.gd:838`, `client/godot/core/sound_core/sound_core.gd:1155`). `SoundPlayedEvent` is still published once per started play, after `_sync_duck`, so QACore telemetry `feedback` counting is unchanged. `get_bgm_key`, `get_playing` and `get_haptic_log`, which `get_sound` reads, are unchanged. The new required settings are in `settings/core-settings.json:476` and the generated `client/godot/generated/core_settings.json:476`, which `CoreSettings` loads. So `SoundCore.init` in the QACore test module start does not lose a setting
  - `TweenCore` now writes `Position`, `Rotation` and `Scale` of a `Control` under a `Container` to its offset transform with `offset_transform_visual_only = false` (`client/godot/core/tween_core/tween_core.gd:1107`). `list_ui` `rect` and `font_size` come from `get_global_transform_with_canvas` (`client/godot/core/qa_core/dev/qa_query.gd:237`, `client/godot/core/qa_core/dev/qa_query.gd:309`). I did not run Godot 4.7.2 to check that this transform includes a non-visual-only offset transform. `TweenStartedEvent` publication is unchanged
- The Godot core tests of QACore were not run in this review. The results above come from reading the code
