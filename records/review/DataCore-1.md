# DataCore review round 1

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

- In the commit range 625ae189..84c58681, only commit ad967246 changes DataCore, in `client/godot/core/data_core/data_core.gd:58-65`. When DataCore is not initialized, `release` now resets only `_builtin_location`, `_builtin_version_read` and `_builtin_version`, and returns. Before, it did the full reset. The range changes nothing in `dev/data_core_dev.gd`, the DataCore tests, `LocalDataCore`, `UtilCore` or `LogCore`
- This matches `## lifecycle` of the `core` skill (`skills/core/SKILL.md:73`): a `release` of a module that is not initialized deletes only the values set by DEV operations and by operations the spec says are called before `init`. It calls no other module, leaves no log and ends no operation. It also matches `## DEV` of the DataCore spec ("A `release` before `init` also resets it"). Before `init`, the only operation that sets a value is `DataCoreDev.set_test_data_location` (`dev/data_core_dev.gd:7-13`), which sets exactly those three variables. `load`, `get_builtin_data_version` and `register_build_derived` refuse before `init` (`data_core.gd:95`, `:131`, `:164`), so no session wait, hook, loaded container or kept version can exist while DataCore is not initialized. A failed `init` (missing `DataCore.downloadedFileMaxBytes`) sets no state, so the short path covers it too
- Test evidence: `client/godot/core/data_core/tests/test_lifecycle.gd:98-100` calls `set_test_data_location` and then `release` while DataCore is not initialized, and checks that the location is back to the default. That test fails if the new branch stops resetting `_builtin_location`
- `_missing_logged` is not cleared by a `release` while not initialized. A `get_row` or `get_rows` before `init`, on a container made before `init` or before an earlier `release`, adds a record to it. By `skills/core/SKILL.md:73` that is not a value the short `release` deletes, because `get_row` is not an operation the spec says is called before `init`. The record also existed before this range, since `init` does not clear it. The DataCore spec sets one `error` log per (container, key) until `release`, while `skills/core/SKILL.md:76` says that every call before `init` logs. I did not judge which of the two decides the log count for repeated lookups before `init`, so this is not written as a finding
- `ogw core test godot DataCore` (job mw8ld8pebdc5b4) passes in this worktree. It left no test record because the checkout has the uncommitted deletion of the earlier `records/review/DataCore-1.md`
- `client/godot/core/bootstrap_core/tests/test_boot_shutdown_pre_init.gd` belongs to BootstrapCore, outside this target. I read it only to see how it calls DataCore and did not run it
- I did not re-read, beyond the code around the change, the generated `GameData` (`load_tables`, `clear`, `is_key_column`, `key_value`) or code the range did not change. Engine-export behavior of `DirAccess.get_files()` on `res://build/data/` was not run; only the dev run of the core test was checked
