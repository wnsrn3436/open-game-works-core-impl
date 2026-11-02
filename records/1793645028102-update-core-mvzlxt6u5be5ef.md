# update core: UICore is_dimmed, QACore list_ui dimmed

## done

- `UICore.is_dimmed` (`client/godot/core/ui_core/ui_core.gd`): whether a visible panel dim or popup dim is drawn above the element, in the order of the UI layers and of the popups on the `Popup` layer. Before `init` it leaves an error log and returns `false`; `null` and an element outside the tree return `false`
- `QACore` `list_ui` element field `dimmed` (`client/godot/core/qa_core/dev/qa_query.gd`)
- The existing dim and system popup behavior was checked against the changed rules. It already follows them, so no behavior code changed:
  - a popup enters `_shown_normal` only after `prepare`, so it has no dim while in `prepare`
  - a popup stays in that list during its close tween, and `_destroy_record` moves the dim when the destruction starts
  - the panel dim follows `_current`, which stays set during the close tween
  - the system popup built in code has dim on and no tweens; a prefab one takes the dim and both tweens from a `UIPopup` root, and has dim off and no tweens otherwise
  - every panel interface call in the popup flows is guarded by `is_system`, or reached only by normal popups
- Core tests: new `client/godot/core/ui_core/tests/test_dimmed.gd` (the `is_dimmed` item, the system popup prefab with a `UIPopup` root, the dim that moves when the destruction of the upper popup starts, and a prefab without a `UIPopup` root) and `test_dimmed` in `client/godot/core/qa_core/tests/test_list_ui.gd`. New test prefabs: `test_panel_dim`, `test_popup_dim_nonmodal`, `test_popup_dim_tween`, `qa_test_popup_dim`
- Generated files: `core-spec/UICore.json` has `is_dimmed`. `client/godot/generated/core_settings.json` lost `uiQuality.maxFlatShare`; the tool regenerated it from the harness, this change did not cause it, and no core code reads that key
- Test results for UICore, QACore and the 23 modules of `ogw core dependents UICore QACore`, 25 modules in all: `ogw core test godot --web` passed 25 of 25 with exit code 0. `ogw core test godot` passed 22 and skipped 3 (see `## unverified`), with exit code 1. The run log summary of each run is 1861 of 1861 tests passed. `ogw code check core`: type check, lint, dependency and secret pass

## spec proposals

none

## review

none

## unverified

- The native render pass of `AccessibilityCore`, `NativeUiCore` and `QACore` did not run, because the macOS screen was locked or the display was asleep. Those three modules are `skipped` in `ogw core test godot`. The browser run of all three passed. Run `ogw core test godot AccessibilityCore NativeUiCore QACore` with the screen unlocked to cover them
- No check was made that the harness UI quality check now passes the popup captures of lantern crypt and pong. That needs `ogw core try` or a release, which the lead agent runs
