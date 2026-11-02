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

- The commit range d4c3ae7..40772f6 changes no file of NativeUiCore (`client/godot/core/native_ui_core/`, `client/godot/plugins/ogw-native-ui/`, `core-spec/NativeUiCore.json`) and no `NativeUiCore.*` settings key. Input `## spec changes` is `none`
- Of the modules NativeUiCore depends on (LogCore, EventCore, TimeCore, LocalDataCore, UICore), the range changes only UICore. It adds `UICore.is_dimmed`, `_is_dimmed` and `_dim_above` at `client/godot/core/ui_core/ui_core.gd`, which change no UICore state. Outside tests, the only caller of `is_dimmed` is `client/godot/core/qa_core/dev/qa_query.gd:271`. NativeUiCore does not call it. The only UICore operation NativeUiCore calls is `UICore.get_layer` (`client/godot/core/native_ui_core/native_ui_core.gd:149`), and its tests also call `UICore.init` (`client/godot/core/native_ui_core/tests/support/native_ui_test_case.gd:41`). The range changes neither. The correctness of `is_dimmed` and of QACore `list_ui` `dimmed` belongs to the UICore and QACore targets and was not judged here
- `client/godot/generated/core_settings.json`: the range removes only `uiQuality.maxFlatShare`. No file under `client/`, `server/`, `tools/`, `settings/` or `fixtures/` refers to that key, and NativeUiCore does not read it. Whether the harness removed that key correctly was not checked, because the harness is outside this target
- I read `native_ui_core.gd`, `native_ui_core_node.gd`, `native_ui_wait.gd`, `adapters/` and `dev/adapters/` against `open-game-works-core/skills/client-core/modules/native-ui-core.md`, and found no problem of severity `medium` or higher to write in `## out of scope`. I did not read `tests/` other than `tests/support/` in full, nor `dev/native_ui_core_dev.gd`, because the range does not change them or the code they call. Which test items of the spec have a test was not compared in this round
- Whether `capture_screen` returns when `RenderingServer.frame_post_draw` does not come (a window that the engine is not drawing) was not run. The spec sets no time limit for that wait, and the engine rule for QACore has a `force_draw` fallback that the NativeUiCore rule at `open-game-works-core/skills/client-core/engines/godot.md:410` does not have. I have no reproduced run, so it is not written as a finding
- I did not review the native plugin sources in `client/godot/plugins/ogw-native-ui/`. They are not in the range
- I did not run any core test, because no finding needed a run. `records/1793645028102-update-core-mvzlxt6u5be5ef.md` reports that, at the end of the range, the browser run of NativeUiCore passed and the native render pass of NativeUiCore did not run because the macOS screen was locked or the display was asleep, so NativeUiCore is `skipped` in `ogw core test godot`. So `test_render_capture.gd` and `test_render_clipboard.gd` have no native result on this range. This report was not checked against the per-module test logs
