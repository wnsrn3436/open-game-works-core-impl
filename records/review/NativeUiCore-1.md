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

- The commit range 772306a..e3deae7 changes no file of NativeUiCore (`client/godot/core/native_ui_core/`, `client/godot/plugins/ogw-native-ui/`, `core-spec/NativeUiCore.json`) and no `NativeUiCore.*` settings key. It changes `client/godot/core/localization_core/`, the `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` settings keys (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings*.json`) and records. NativeUiCore does not depend on LocalizationCore. The only contact is that the NativeUiCore tests start `LocalizationCore.init()` in `client/godot/core/native_ui_core/tests/support/native_ui_test_case.gd:38`, and the two new keys have defaults in the core settings, so `_read_settings` still passes there. I read all of `native_ui_core.gd`, `native_ui_wait.gd`, `native_ui_core_node.gd`, `share_content.gd`, `adapters/`, `dev/` and `tests/` against the spec and found no change in this range that causes or reveals a problem in them
- No core test was run (headless, render, browser or plugin build). The render tests (`test_render_capture.gd`, `test_render_clipboard.gd`), the browser tests (`test_web_browser.gd`) and the macOS plugin build test were read but not run
- I did not review the native plugin sources in `client/godot/plugins/ogw-native-ui/` (macOS and iOS `.mm`, and the Android side) beyond confirming they exist. They are not in the range
