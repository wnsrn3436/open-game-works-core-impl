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

- The commit range 47b588d..bcdb386 changes no file under `client/godot/core/shortcut_core/` and no ShortcutCore spec (`## spec changes` is `none`). The changes are in `BootstrapCore` (fatal screen font), `QACore` DEV `step` (paused game time) and `RequirementCore` watch owner tracking (`_owner_slots`, `_on_frame`). ShortcutCore calls only `RequirementCore.evaluate` and `RequirementCore.fill_guide_args` (`client/godot/core/shortcut_core/shortcut_core.gd:102`, `client/godot/core/shortcut_core/shortcut_core.gd:183`), and the range does not change them. It calls no `watch`, `unwatch` or `QACore`/`BootstrapCore` API, so the range causes or reveals no ShortcutCore problem
- `client/godot/core/shortcut_core/shortcut_core.gd` and `shortcut_wait.gd` were read against the stage table of the spec and no deviation was seen, but because the range does not touch them, they were not reviewed line by line for every aspect, and the ShortcutCore tests were not read or run
- Core tests were not run
