# review BootstrapCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit 3b801007 adds `client/godot/core/bootstrap_core/tests/test_boot_shutdown_auth_dev_values.gd`. Its first test boots with `AuthCore` in the module list, writes the storage item of the scope, sets the fake social account and fake tracking state, calls `shutdown`, checks that the storage item is gone, boots again and checks that neither fake value remains. Its second test does the same with no `AuthCore` in the module list. I restored the defect in a temporary `git worktree add` copy of HEAD by replacing `_dev.before_shutdown_release()` at `client/godot/core/bootstrap_core/bootstrap_core.gd:1291` with `pass`. With that change, `ogw core test godot BootstrapCore --file client/godot/core/bootstrap_core/tests/test_boot_shutdown_auth_dev_values.gd` failed both tests ("the next test finds no storage item", `fake:shutdown_frank`, tracking `4`). In a second variant I moved the call after the release loops, so it runs once the scope text is gone. The first test then failed on the storage item assert, so the test also checks that the call runs while the scope text of `AuthCore` is still set (skills/client-core/modules/bootstrap-core.md:235). On HEAD, `ogw core test godot BootstrapCore` passes |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I read the `auth_core.gd` changes of the range that BootstrapCore reaches: `_storage_call` now returns `null` when a wait was ended, and `_auto_login` (through `boot_login`) and `withdraw` changed with it. BootstrapCore calls `boot_login`, `dev_login`, `issue_deletion_code`, `set_storage_scope`, `set_social_adapter`, `use_dev_token_storage` and `clear_dev_values`. `clear_dev_values` ends storage waits only from `shutdown`, after the boot is `Halted`, so the `FAILED` result that `boot_login` now returns there does not reach a boot stage. I did not run the AuthCore core tests
- The DEV token storage cleared by `shutdown` (`use_dev_token_storage`) is not observed directly by the BootstrapCore test, as the fix report says. Every boot with `AuthCore` passes it again in `InitModules` 2, so no BootstrapCore-observable result depends on it. That clearing is left to the AuthCore core tests, which I did not run
- The first new test asserts that there is no `OgwSecureStorage` singleton in the core test process. I did not check it on a host whose core test process has that singleton
- I did not run the browser run (`--web`) of the BootstrapCore tests
- The other code changes of the range (tests of AdCore, NativeUiCore, NetworkCore, NoticeCore, PaymentCore, PushCore and RealtimeCore, the server iap and item-ledger tests) do not change code that BootstrapCore calls, so I did not check them further
