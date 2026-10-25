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

- The commit range 2ef5ae8d..f82c154 changes no file under `client/godot/core/shortcut_core/`, no `core-spec/ShortcutCore.json`, no `tools/data-tool` file (including `tools/data-tool/src/checks/ShortcutCore.ts`) and no ShortcutCore spec (`## spec changes` is `none`). It also changes no file of the modules ShortcutCore depends on (`LogCore`, `EventCore`, `DataCore`, `LocalizationCore`, `RequirementCore`, `MessageCore`, `UICore`, `SceneCore`) under `client/godot/core/`. The client changes in the range are in `AuthCore`, `BootstrapCore`, `SoundCore` (pitch/volume variation, voice duck), `TweenCore` (arranged tweens), the generated core contract and generated core settings (new `SoundCore.*`, `public-profile.findPerMinute` and `uiQuality` keys). ShortcutCore reads no core settings and no contract type (`client/godot/core/shortcut_core/shortcut_core.gd` refers only to `LogCore`, `EventCore`, `GameData`, `RequirementCore`, `MessageCore`, `UICore`, `SceneCore`, `CoreScriptErrors` and its own files), so the range causes or reveals no ShortcutCore problem
- `client/godot/core/shortcut_core/shortcut_core.gd` and `shortcut_wait.gd` were read against the stage table, error table and release behavior of the spec and no deviation was seen, but because the range does not touch them, they were not reviewed line by line for every aspect, and the ShortcutCore tests under `client/godot/core/shortcut_core/tests/` were not read or run
- Core tests were not run
