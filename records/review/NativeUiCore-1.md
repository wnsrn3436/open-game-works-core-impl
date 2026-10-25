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

- The commit range d4e2728..3e59431 changes no file of NativeUiCore (`client/godot/core/native_ui_core/`, `client/godot/plugins/`, `core-spec/NativeUiCore.json`) and no `NativeUiCore.*` settings key. Of the modules NativeUiCore depends on (LogCore, EventCore, TimeCore, LocalDataCore, UICore), it changes only UICore: it adds `UICore.is_flow_in_progress` at `client/godot/core/ui_core/ui_core.gd:653-665` and its tests in `client/godot/core/ui_core/tests/test_popup.gd`. The change is additive and does not change `UICore.get_layer`, the only UICore operation NativeUiCore calls (`client/godot/core/native_ui_core/native_ui_core.gd:149`, in `capture_screen`), or `UICore.init`, which the NativeUiCore tests call (`client/godot/core/native_ui_core/tests/support/native_ui_test_case.gd:41`). NativeUiCore does not call `is_flow_in_progress`
- Other changes of the range that the NativeUiCore tests run through: `TweenCore.get_finite_playing_count` is added (`client/godot/core/tween_core/tween_core.gd:326-337`) without changing `TweenCore.init`, which `native_ui_test_case.gd:41` calls; UnitTestCore now sends `PUT /started` before the first test (`client/godot/core/unit_test_core/dev/unit_test_core.gd:228`, `:939-959`) and adds the core setting `UnitTestCore.startTimeLimitMs`, which has a default in `settings/core-settings.json` and `client/godot/generated/core_settings.json`. Neither changes what a NativeUiCore test asserts
- I read all of `client/godot/core/native_ui_core/native_ui_core.gd` against the spec and found no change in this range that causes or reveals a problem in it. I did not reread `native_ui_wait.gd`, `native_ui_core_node.gd`, `adapters/`, `dev/` or `tests/` in full, because the range does not change them or the code they call
- I did not run any core test (headless, render, browser or plugin build)
- I did not review the native plugin sources in `client/godot/plugins/`. They are not in the range
