# review NativeUiCore round 1

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

- The commit range de482eec..45426db9 changes no file of `client/godot/core/native_ui_core/` and no file of its dependencies `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `UICore`. It changes `CameraCore`, `PoolCore`, `QACore`, `ScreenEffectCore`, `SoundCore`, `TweenCore`, the `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs` settings keys (settings/core-settings.json, settings/core-settings.schema.json, client/godot/generated/core_settings.json, client/godot/generated/core_settings_types.json, core-spec/QACore.json, server/core/testing/dev/setting_types.ts) and records. NativeUiCore reads none of those settings keys, and none of the changed modules calls NativeUiCore (only `BootstrapCore` refers to it, unchanged). The `### feedback switch` of the `QACore` spec (open-game-works-core/skills/client-core/modules/qa-core.md:236-237, 428-430) names no NativeUiCore behavior. So no change of the range causes or reveals a NativeUiCore problem
- NativeUiCore core tests run headless (GUT with the harness pre-run and post-run hooks and a fresh `user://`): 36 of 36 tests pass, 399 asserts. client/godot/core/native_ui_core/tests/test_render_capture.gd and client/godot/core/native_ui_core/tests/test_render_clipboard.gd skip themselves in a headless run, and the rendered run was not run here, so the `capture_screen` and `copy_text` tests of a run that is not a headless run were not checked by running
- client/godot/core/native_ui_core/tests/test_web_browser.gd needs the browser runtime and was not run here
- The android, ios and macos plugin builds of `ogw-native-ui` (plugins/) were not built or run here; only client/godot/core/native_ui_core/tests/test_plugin_adapter.gd ran
- Code outside the range was skimmed only (client/godot/core/native_ui_core/native_ui_core.gd), not reviewed in full, as the range does not reach it
