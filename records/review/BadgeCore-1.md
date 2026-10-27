# BadgeCore review round 1

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

- The commit range `cf89b7f..5184b49` changes no BadgeCore code or test and no file of `core-spec/BadgeCore.json`. `git diff --name-only` shows no file under `client/godot/core/badge_core/` and no file of the BadgeCore dependency modules (LogCore, EventCore, TimeCore, ResourceCore, LocalDataCore, LocalizationCore, DataCore, UserStateCore, RequirementCore). The client changes are `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd`, `client/godot/core/qa_core/dev/qa_core.gd`, `client/godot/core/qa_core/dev/qa_telemetry.gd`, `client/godot/core/qa_core/tests/test_telemetry.gd`, `client/godot/engine.json`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json` and the new `client/godot/plugins/ogw-secure-storage/` files
- Checked where the changed files reach BadgeCore. BadgeCore reads core settings only through `CoreSettings.has_string`/`get_string`/`has_int`/`get_int` for its `BadgeCore.*` keys (`client/godot/core/badge_core/badge_core.gd:806`). The `core_settings.json` diff changes `routing.ipRateLimitPerMinute` and adds `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, all server keys, so no BadgeCore key changes
- The BadgeCore test setup (`client/godot/core/badge_core/tests/support/badge_test_case.gd:60`) does not init QACore or AuthCore, and BadgeCore code does not refer to them (`grep` of `client/godot/core/badge_core/` for `QACore`, `AuthCore`, `secure_storage` has no match). The QACore change (release inputs go to `add_release` instead of `add_input`) is DEV code that BadgeCore does not call
- The new `client/godot/plugins/ogw-secure-storage/` `.gdextension` files do not load in the BadgeCore test project: `client/godot/plugins/.gdignore` makes Godot skip the whole `plugins/` folder. The `engine.json` item only declares the plugin for the macOS build
- Code that existed before the range was not reviewed again; it is outside the changes of this range
- The BadgeCore core tests were not run in this review. The run needs the GUT setup, the test host and the core fixtures that `ogw core test` prepares, so whether they pass on `5184b49` is not checked here
