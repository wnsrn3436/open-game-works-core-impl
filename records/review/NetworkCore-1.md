# NetworkCore review round 1

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

- The commit range cf89b7fd2768ede33b78f5948fb0fae06df506e2..e95ea0c28968432888f52b57655c45291ea07a76 changes no NetworkCore code, test or spec: `git diff --stat` of the range on `client/godot/core/network_core/` and `core-spec/NetworkCore.json` is empty, and `## spec changes` is `none`. Of the modules in `## dependency` of the NetworkCore spec (`LogCore`, `EventCore`, `TimeCore`, `DataCore`, `UserStateCore`, `InputBlockCore`, `UICore`, `MessageCore`) and its server dependencies (`session`, `logging`), none changes in the range
- The client core changes in the range are only in `AuthCore` tests (new `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd`) and in `QACore` DEV code (`client/godot/core/qa_core/dev/qa_core.gd:819`, `client/godot/core/qa_core/dev/qa_telemetry.gd:157`: release inputs go to `add_release` instead of telemetry `inputs`). `AuthCore` reaches NetworkCore only through `set_session_provider` and `send_auth`, and the range does not change `AuthCore` code that calls them. `QACore` is not a NetworkCore dependency, and the change does not call NetworkCore
- The core settings changes in the range (`routing.ipRateLimitPerMinute` 60 to 300, new `storage.sweepBatchSize` and `storage.sweepTableBudgetMs` in `settings/core-settings.json` and `client/godot/generated/core_settings.json`) are server keys of `routing` and `storage`. NetworkCore code and tests do not read them (no match for `routing.` or `storage.` under `client/godot/core/network_core/`). The `client/godot/engine.json` change only adds the `ogw-secure-storage` plugin entry. Judged from the code only
- The NetworkCore core tests were not run in this review, because the range changes nothing that NetworkCore code or its tests reach
- NetworkCore code and tests were not reviewed line by line for problems outside the range, because they are not changed in the range and are not reached by the changes
