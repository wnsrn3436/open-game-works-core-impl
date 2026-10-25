# NativeUiCore review round 1

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

- The commit range 2ef5ae8..f9c4c29 changes no file of NativeUiCore (`client/godot/core/native_ui_core/`, `client/godot/plugins/`, `core-spec/NativeUiCore.json`) and no `NativeUiCore.*` settings key. It changes no module that NativeUiCore depends on (LogCore, EventCore, TimeCore, LocalDataCore, UICore). In the client it changes `client/godot/core/auth_core/`, `client/godot/core/bootstrap_core/bootstrap_core.gd` (only the ban and deletion popup format arguments; `set_native_adapter` at `client/godot/core/bootstrap_core/bootstrap_core.gd:913-926` is unchanged), `client/godot/core/sound_core/`, `client/godot/core/tween_core/`, the generated contract and settings, and the server core
- The only places the range touches NativeUiCore: (1) The NativeUiCore tests start SoundCore and TweenCore in `client/godot/core/native_ui_core/tests/support/native_ui_test_case.gd:37-41`. SoundCore `init` now reads `SoundCore.sfxPitchVariationCents`, `SoundCore.sfxVolumeVariationDb`, `SoundCore.voiceDuckDb`, `SoundCore.voiceDuckAttackMs` and `SoundCore.voiceDuckReleaseMs`, and all five have defaults in `settings/core-settings.json` and `client/godot/generated/core_settings.json`. The run records `records/1792942433228-update-core-mvnzmrijb7b2e4-runs.json` and `records/1792943039981-update-core-mvnzzrot011e4e-runs.json` show `ogw core test godot` runs that include NativeUiCore after these changes ending with exit code 0 (headless and `--web`). (2) `benchmark/godot/client/features/bench/bench_option_panel.gd:96` now passes the grouped public code to `NativeUiCore.copy_text`. That is benchmark game code, not the target
- I read all of `client/godot/core/native_ui_core/native_ui_core.gd` against the spec and found no change in this range that causes or reveals a problem in it. I did not reread `native_ui_wait.gd`, `native_ui_core_node.gd`, `adapters/`, `dev/` or `tests/` in full, because the range does not change them or the code they call
- I did not run any core test myself (headless, render, browser or plugin build). Evidence of passing runs comes only from the run records above
- I did not review the native plugin sources in `client/godot/plugins/`. They are not in the range
