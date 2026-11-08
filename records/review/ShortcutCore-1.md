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

- Commit range 85f6b36d..e8ab3830 changes no file under `client/godot/core/shortcut_core/`, no ShortcutCore data check (`tools/data-tool/src/checks/ShortcutCore.ts`, `tools/data-tool/tests/shortcut-core-check.test.ts`), no `core-spec/ShortcutCore.json`, no shortcut table (`test-data/data/tables/shortcut.csv`, `tools/tests/game/data/tables/shortcut.csv`) and no ShortcutCore settings key in `client/godot/generated/core_settings.json`
- Of the dependency modules (`LogCore`, `EventCore`, `DataCore`, `LocalizationCore`, `RequirementCore`, `MessageCore`, `UICore`, `SceneCore`), only `client/godot/core/log_core/log_core.gd` changes in the range, and only in comments (`_escape`, `_event_problem`, `_enqueue_error`), so no behavior that ShortcutCore calls changes; the two changed LogCore test files are LogCore tests and are not read by ShortcutCore
- Input `## spec changes` is `none`, so ShortcutCore code was not compared with the whole spec again; the code of ShortcutCore outside the range (unchanged since 85f6b36d) was not reviewed in this round
- ShortcutCore core tests were not run: no finding needed checking
