# review: UnitTestCore round 1

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

- The commit range `cf89b7fd..e95ea0c` changes no file under `client/godot/core/unit_test_core/` (`git diff --quiet` of that folder is empty). The client changes in the range are AuthCore (`auth_core/tests/test_secure_storage_plugin.gd`), QACore (`qa_core/dev/qa_core.gd`, `qa_core/dev/qa_telemetry.gd`, `qa_core/tests/test_telemetry.gd`), the new `ogw-secure-storage` plugin and its `engine.json` entry, and generated core settings. I read them only to see whether they reach UnitTestCore code
- The only path from those changes into UnitTestCore code is `client/godot/generated/core_settings_types.json`, which `unit_test_core.gd:94` reads for `set_test_settings`. The range adds the `integer` keys `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, which are of a settings type that `set_test_settings` already handles. No UnitTestCore behavior changes because of them
- The `ogw-secure-storage` macOS plugin is now put into the core project by `ogw core test` on a macOS host. I did not run the core tests to check that loading that GDExtension writes no `SCRIPT ERROR:` line or app storage file that would change a UnitTestCore run result; I checked only that UnitTestCore code does not refer to the plugin
- The rest of the range (server core, harness records, README, licenses) is outside this client target. I did not review it
