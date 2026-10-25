# review CutsceneCore round 1

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

- The commit range 2ef5ae8..f28106a changes no CutsceneCore file and no CutsceneCore spec. Of the modules CutsceneCore depends on, it changes only SoundCore (`Sfx` pitch and volume variation, `Bgm` voice duck, client/godot/core/sound_core/sound_core.gd) and TweenCore (arranged element offset transform, client/godot/core/tween_core/tween_core.gd:641-665, :1020-1117), with their tests and settings. The other client changes (AuthCore, BootstrapCore, generated contract) are not called by CutsceneCore. Checked how the changes reach CutsceneCore:
  - TweenCore: CutsceneCore calls `TweenCore.play` only for `Move` on an actor (client/godot/core/cutscene_core/cutscene_core.gd:1096), and `register_actor` accepts only `Node2D` or `Node3D` (cutscene_core.gd:333). `_is_arranged` is true only for a `Control` whose parent is a `Container` (tween_core.gd:1021-1022), so every `Move` takes the non-arranged path of `_read` and `_write`, as before the range. The finalize of `Move` goes through `TweenCore.skip_to_end` (cutscene_core.gd:1262) into `_apply_end_state`, whose non-arranged write is unchanged. `Camera` and `ScreenEffect` tweens are run by CameraCore and ScreenEffectCore and are not CutsceneCore code
  - SoundCore variation: applies only to `Sfx` playback (sound_core.gd:838-843). The line voice and replay voice play on `Voice` (cutscene_core.gd:1370, :1829), so voice end through `SoundCore.is_playing` (cutscene_core.gd:1403) keeps its timing. The `Sound` command plays on `Sfx` (cutscene_core.gd:955) and ends at once, so a changed pitch scale only changes when SoundCore frees a non-looping sound; a looping sound has length 0 (sound_core.gd:955-963) and stays until CutsceneCore stops its kept handle
  - SoundCore duck: the line voice now lowers the `Bgm` bus gain while it plays. CutsceneCore spec sets no BGM volume behavior; the "BGM right before and right after playback end handling are the same" test item is about which BGM plays, which the duck does not change. The cutscene pause stops the `Voice` bus through `TimeCore.set_paused(true)` (cutscene_core.gd:1714), which the SoundCore spec sets as the start of the duck release
  - The new SoundCore settings keys are in settings/core-settings.json and client/godot/generated/core_settings.json, so `SoundCore.init` in the CutsceneCore test setup (client/godot/core/cutscene_core/tests/support/cutscene_test_case.gd:147) still finds them
- The CutsceneCore tests were not run in this review (`ogw core test` needs the GUT setup and the test host, and the checkout has no `addons/`). Whether they pass at f28106a is not checked here
