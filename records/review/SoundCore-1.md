# review SoundCore round 1

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

- The Godot tests were not run. Results were judged by reading `client/godot/core/sound_core/tests/test_duck.gd`, `client/godot/core/sound_core/tests/test_variation.gd` and `client/godot/core/sound_core/tests/support/sound_test_case.gd` against the code. Whether they pass on the pinned engine is not checked
- The audible output was not measured. The review did not check that `AudioEffectAmplify.volume_db` on the `Bgm` bus and `AudioStreamPlayer.volume_linear` / `pitch_scale` on the sfx players change the mixed output as the `godot` mapping says. Only the property values were checked
- Duck timing is recalculated in `_sync_duck` (`client/godot/core/sound_core/sound_core.gd:1155`) only when SoundCore runs: on each frame, on a pause change and when a slot starts or is freed. So a voice that ends by reaching its sound length, or a game time pause made by `TimeCore.set_paused`, moves the duck up to one frame late. The spec does not set a precision finer than this, so this was not written as a finding
- Only the SoundCore part of the commit range was reviewed: `client/godot/core/sound_core/`, `core-spec/SoundCore.json`, the `SoundCore.*` keys of `settings/core-settings.json`, `settings/core-settings.schema.json` and `client/godot/generated/core_settings*.json`, and the callers of `SoundCore.play` in `accessibility_core`, `ui_core`, `cutscene_core` and the `ad_core` tests (for the effect of the default pitch variation on `Sfx` play ends). Other modules changed in the range were not reviewed
