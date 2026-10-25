# ShortcutCore review round 1

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

- The commit range d4e2728f..4d96a0ca changes no file under `client/godot/core/shortcut_core/`, no `core-spec/ShortcutCore.json` and no ShortcutCore spec (`## spec changes` is `none`). Of the modules ShortcutCore depends on, only `UICore` changes: `client/godot/core/ui_core/ui_core.gd:653` adds `is_flow_in_progress` (and `core-spec/UICore.json:259` lists it). That operation only reads UICore state, its only caller in the defining documents is `QACore` (`ui-core.md` API table), ShortcutCore does not call it, and the UICore operations ShortcutCore calls (`is_panel_transitioning`, `close_all_popups`, `close_panels_to`, `open_panel`, `open_panels`) are unchanged in the range. The other client changes in the range are in `AuthCore` tests, `ScreenEffectCore`, `TweenCore`, `UnitTestCore` and generated core settings (`QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs`, `uiQuality.settleLimitMs`); ShortcutCore reads no core settings. So the range causes or reveals no ShortcutCore problem
- `client/godot/core/shortcut_core/shortcut_core.gd` and `shortcut_wait.gd` were read against the stage table, error table and release behavior of the spec and no deviation was seen, but because the range does not touch them, the ShortcutCore tests under `client/godot/core/shortcut_core/tests/` were not read line by line
- Core tests were not run
