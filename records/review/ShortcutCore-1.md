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

- The commit range cf89b7fd..cfd79ece changes no file under `client/godot/core/shortcut_core/`, no ShortcutCore entry in `core-spec/` and no ShortcutCore spec (`## spec changes` is `none`). It changes no file of the modules ShortcutCore depends on (`LogCore`, `EventCore`, `DataCore`, `LocalizationCore`, `RequirementCore`, `MessageCore`, `UICore`, `SceneCore`). It also changes none of the files outside the module that name ShortcutCore or the `shortcut` table (`client/godot/generated/core_modules.gd`, `client/godot/generated/data/game_data.gd`, `client/godot/dev/generated/data/game_data_dev.gd`, `client/godot/core/notice_core/notice_core.gd`, `client/godot/core/bootstrap_core/tests/support/boot_test_support.gd`). The client changes in the range are: `QACore` release inputs (`client/godot/core/qa_core/dev/qa_core.gd:819`, `client/godot/core/qa_core/dev/qa_telemetry.gd:157`) and their test; the `ogw-secure-storage` macOS plugin, its `client/godot/engine.json` item and an `AuthCore` plugin test; and generated core settings (`routing.ipRateLimitPerMinute`, `storage.sweepBatchSize`, `storage.sweepTableBudgetMs`). ShortcutCore reads no core settings and calls none of these. The other changes are server core (`ads-reward`, `routing`, `storage` and test-only edits), `core-spec/ads-reward.json`, `core-spec/storage.json`, `licenses.json`, README files and `records/`. So the range causes or reveals no ShortcutCore problem
- `client/godot/core/shortcut_core/shortcut_core.gd`, `shortcut_wait.gd` and `events/shortcut_navigated_event.gd` were read against the stage table, error table, event and release behavior of the spec and no deviation was seen. Of the tests, only `tests/test_release.gd` and `tests/test_errors.gd` were read. The other test files under `client/godot/core/shortcut_core/tests/` were not read line by line because the range does not touch the module
- Core tests were not run
