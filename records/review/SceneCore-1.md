# SceneCore review round 1

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

- The commit range 2ef5ae8d..d6671e8 changes no file under `client/godot/core/scene_core/`. The changes in that range that SceneCore code or its tests reach were checked: `client/godot/core/tween_core/tween_core.gd` (arranged element writes go to the offset transform), `client/godot/core/sound_core/sound_core.gd` (init reads five new settings), `client/godot/core/bootstrap_core/bootstrap_core.gd` (ban popup format argument), `client/godot/generated/core_settings.json` and `settings/core-settings.json`. None of them changes a SceneCore setting, a call that SceneCore makes, or a behavior that SceneCore relies on:
  - TweenCore: SceneCore does not call TweenCore. The arranged element path applies only to a `Control` whose parent is a `Container`; `SafeAreaRoot` (`client/godot/core/safe_area_core/safe_area_root.gd:2`) extends `Control`, so the scene UI root and the loading screen under the SceneCore safe area roots are not arranged elements. The SceneCore test `client/godot/core/scene_core/tests/test_transition.gd:75` plays an opacity tween (`property = 4` in `client/godot/core/scene_core/tests/resources/block_tween.tres`) on a `Control` that is not in a `Container`, so its path is unchanged
  - SoundCore: the new settings `SoundCore.sfxPitchVariationCents`, `SoundCore.sfxVolumeVariationDb`, `SoundCore.voiceDuckDb`, `SoundCore.voiceDuckAttackMs`, `SoundCore.voiceDuckReleaseMs` are in the generated core settings, so `SoundCore.init()` in `client/godot/core/scene_core/tests/support/scene_case.gd:112` still finds them
  - BootstrapCore: only the ban and deletion code popups changed; its calls to `SceneCore.boot_change_scene` and `SceneCore.change_scene` are unchanged
- The tests were not run (no Godot run in this review). The judgement above is from reading code
- Code of SceneCore outside the range was read (`client/godot/core/scene_core/scene_core.gd`) only to see what the changed modules reach; it was not reviewed item by item against every `## test` item of the spec, since problems that existed before the range and are unrelated to its changes are not in scope of this round
