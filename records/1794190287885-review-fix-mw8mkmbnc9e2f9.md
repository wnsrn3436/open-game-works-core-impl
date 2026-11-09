# review fix BootstrapCore round 1

## done

- `BootstrapCore` (Godot): added core test file `client/godot/core/bootstrap_core/tests/test_boot_shutdown_auth_dev_values.gd`. No implementation change
- No engine-specific implementation rules document written; `## <engine> build` of `tools/ogw.md` not written
- Last `ogw core test`: `godot BootstrapCore QACore UnitTestCore` and the same with `--web` (BootstrapCore and the modules `ogw core dependents BootstrapCore` lists), all pass. `ogw code check core`: type check, lint, dependency, secret pass

## spec proposals

none

## review

- R1-1: fixed. Added `client/godot/core/bootstrap_core/tests/test_boot_shutdown_auth_dev_values.gd`:
  - `test_shutdown_clears_the_dev_values_and_deletes_the_storage_item_of_the_scope`: boots with `AuthCore` in the module list (dev login, to `Done`), writes the storage item of the scope at the location the engine-specific implementation rules give for that run (DEV token storage file `user://ogw_dev_tokens/<scope text>.json`, or `window.localStorage` key `ogw.<scope text>` in the browser runtime), calls `AuthCoreDev.set_fake_social_account` and `set_fake_tracking_status`, calls `shutdown`, and checks that the storage item is gone. It then boots again with `AuthCore` and checks that `FakeSocialAdapter.sign_in` does not return the fake account and that `AuthCore.get_consent().tracking` is not the fake tracking state. A delete started after `AuthCore.release` (scope text empty) would leave the item, so this also checks that the call comes while the scope text is set
  - `test_shutdown_clears_the_dev_values_when_auth_core_is_not_in_the_module_list`: boots with no `AuthCore` in the module list, sets the fake values, calls `shutdown`, boots with `AuthCore`, and checks the same two fake values are gone
  - Reproduced the finding: with `client/godot/core/bootstrap_core/bootstrap_core.gd:1291` (`_dev.before_shutdown_release()`) replaced by `pass`, both new tests fail (storage item still there, `fake:shutdown_frank` credential, tracking `4` = DENIED). With the line restored, both pass
  - The test reads the values through public behavior, not `AuthCore._` fields: the core static check `private name` does not allow `_` names of `auth_core` in BootstrapCore tests

## unverified

- Clearing the DEV token storage (`use_dev_token_storage`) by `shutdown` is not checked directly in the BootstrapCore test. Every boot with `AuthCore` in the module list passes it again in `InitModules` 2, and BootstrapCore tests cannot read the private `AuthCore._dev_storage`. The removal of the storage item and of the two fake values shows that `clear_dev_values` runs in `shutdown`, and the AuthCore core tests (`auth_core/tests/test_lifecycle.gd`, `test_storage.gd`) check that `clear_dev_values` clears the DEV token storage
- The case "after the storage operations in progress" is not checked in the BootstrapCore test: the DEV token storage and the browser storage finish each operation in the same call, and a held storage cannot be swapped in without private `AuthCore` names. `auth_core/tests/test_storage.gd::test_clear_dev_values_fails_the_waiting_caller_and_deletes_after_the_operation_in_progress` checks that order
- The first test asserts there is no `OgwSecureStorage` singleton in the core test process (engine-specific implementation rules: a core test process has none on macOS or on a host without a plugin build). On a host whose core test process has that singleton, the test fails on that assert, because the item location in OS secure storage cannot be read from a test
