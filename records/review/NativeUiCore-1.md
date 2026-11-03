# review: NativeUiCore round 1

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

- The commit range `f3ac5b0..0da153b` changes only `client/godot/core/localization_core/localization_core.gd`, `client/godot/core/localization_core/tests/test_font_weight.gd` and `records/`. It changes no file of the target (`client/godot/core/native_ui_core/`, `client/godot/plugins/ogw-native-ui/`), of its dependencies (`log_core`, `event_core`, `time_core`, `local_data_core`, `ui_core`), of `bootstrap_core`, of `settings/` or of `core-spec/`. The input has `## spec changes` `none` and no `## debt` or `## must fix` item, so there is no change for a finding to come from. This round is not a review of the whole target: a whole review needs commit range `none`
- The only link from the target to the changed code is `client/godot/core/native_ui_core/tests/support/native_ui_test_case.gd:40`, which calls `LocalizationCore.init()` to start `UICore`. The changed function `_restore_heading_types` only changes the heading types of the font theme. NativeUiCore reads no theme, and the render capture test checks only `ColorRect` pixels. This was judged by reading the code
- Tests were not run: `ogw core test` was not run for NativeUiCore in the native run or the browser run, because no finding needed checking. No test result of this round says the target passes
- Beyond the range, these were read once to look for `## out of scope` problems, and none reached confidence 80: `native_ui_core.gd`, `native_ui_core_node.gd`, `native_ui_wait.gd`, `share_content.gd`, the three adapters, the fake adapter and DEV class, the test files except `tests/support/silent_native_ui_plugin.gd` and the bodies of `tests/test_web_browser.gd` after line 60, `OgwNativeUiPlugin.java`, the iOS and macOS `ogw_native_ui.mm`, the Android manifest and FileProvider paths, and the adapter choice in `bootstrap_core.gd`. This was a read, not a whole-target review
- Not read: `client/godot/plugins/ogw-native-ui/build.sh`, `android/plugin/build.gradle.kts`, `android/addon/`, `ios/ogw-native-ui.gdip`, `ios/src/ogw_native_ui.h`, `macos/src/ogw_native_ui.h`, `macos/src/register_types.mm`, `dist/`, the implementations of the dependency modules
- Not run on a device or browser: the review window and share window of `android`, `ios`, `macos` and `web`. In particular these were not observed: whether the iOS `completionWithItemsHandler` and the macOS `didChooseSharingService:` report every way the window closes, and whether the Android `onMainActivityResult` arrives before the foreground event
