# update core: AuthCore

## done

- `AuthCore` (Godot), commit on `agent/mw8gsat89e78fb`
  - `release` (and the app-exit cleanup) no longer deletes the values of `set_fake_social_account`, `set_fake_tracking_status` and `use_dev_token_storage` (`client/godot/core/auth_core/auth_core.gd` `_clean_up`). They hold across `release` and the next `init`
  - New DEV operation `AuthCoreDev.clear_dev_values()` (`client/godot/core/auth_core/dev/auth_core_dev.gd`). It works before `init`, while `init`ed and after `release`, with no log. It ends the callers that wait for a storage operation as failures, deletes the three DEV values and the pending token (and the login token and linked providers kept with it), and, while `init`ed with a non-empty scope text, queues a delete of the storage item of that scope on the storage in use. The delete runs after the storage operations in progress, through the existing storage queue, and its result is dropped. The operations in progress go on and their late results are dropped
  - So that only storage callers end (and not network or popup waits), the waits of storage callers are now kept in their own list `_storage_waits`. `release` ends them as before through `_end_storage_waits()`, and `clear_dev_values` calls the same function. No other behavior changed
- Tests changed or added (all in `client/godot/core/auth_core/tests/`)
  - `test_lifecycle.gd`: `test_release_clears_state...` no longer expects the three DEV values to be cleared. New test `test_release_keeps_the_dev_values_until_clear_dev_values`
  - `test_dev.gd`: new test `test_fake_account_name_holds_across_release_until_clear_dev_values`, which checks the fake credential after a restart and the default fake account after `clear_dev_values`
  - `test_consent.gd`: new test `test_fake_tracking_status_holds_across_release_until_clear_dev_values`
  - `test_dev_token_storage.gd`: `test_release_drops_the_dev_token_storage` becomes `test_release_keeps_the_dev_token_storage_and_clear_dev_values_drops_it`. `_restart_with_platform_storage` calls `clear_dev_values` after `release`, because the test that restarts without the DEV token storage relied on `release` dropping it
  - `test_storage.gd`: four new tests. (1) While `init`ed, it deletes only the item of its scope, keeps the session, and leaves no log. (2) While a read is held, the waiting `boot_login` ends `Failed`, the delete runs after the held read (end order `read`, `remove`), the item is gone, and there is no `AutoLogin`. (3) After `release`, it deletes the kept pending token: the next `boot_login` sends `AutoLogin` with the stored token, not the pending one, and no storage operation starts. (4) Before `init`, and while `init`ed with an empty scope text, no delete starts
  - `support/auth_test_env.gd`: `boot()` calls `AuthCoreDev.clear_dev_values()` in place of `AuthCore._clear_pending()`, so the DEV values that `release` now keeps do not reach the next AuthCore test
- Changes outside the module: none. `BootstrapCore`, `QACore` and `UnitTestCore` are unchanged, as the input asked
- Engine-specific implementation rules / `## godot build` of `tools/ogw.md`: not written (not a target)
- Runs (both on commit e6caa1ef)
  - `ogw core test godot` with AuthCore and its dependents AdCore, BootstrapCore, PaymentCore, PushCore, QACore, RealtimeCore, RemoteConfigCore, TutorialCore, UnitTestCore: `--web` passed. The first headless run failed only in RealtimeCore, with engine WebSocket errors (`Not enough response headers. Got: 2, expected >= 4`). RealtimeCore alone passed on rerun. The last headless run of the full set passed for every module (the tool reused the passing per-module results of this commit)
  - `ogw code check core`: type check, lint, dependency and secret all pass

## spec proposals

- `clear_dev_values` before `init`: the spec says the delete goes to "the storage and the scope text that AuthCore uses when it is called". Before `init`, AuthCore uses no storage, even when `set_storage_scope` set a scope text. The implementation starts no delete there. Proposal: say so explicitly in the `clear_dev_values` row (e.g. "before `init` and after `release`, no delete starts"). Otherwise a reader can take the scope text set before `init` as a reason to delete in the storage that `init` would choose
- Until `BootstrapCore` `shutdown` calls `clear_dev_values` (the later job), the three DEV values that `release` now keeps carry from one core test into the next tests of the same run. Only the AuthCore test env clears them. That later job should land before tests that depend on the default fake account or tracking state are added to other modules

## review

none

## unverified

- `release` of an AuthCore that is not `init`ed still does nothing (it does not delete the scope text and social adapters set before `init`). This is the behavior from before this change, kept as the input asked, but it does not match `## lifecycle` of the `core` skill ("deletes the values that its operations called before `init` set")
- The delete that `clear_dev_values` starts was checked with the core test fake storage only. On OS secure storage, browser storage and DEV token storage it goes through the same `remove_item` as the account recovery new start and the install marker check
- The cause of the headless RealtimeCore failure in the first run (WebSocket response header errors from the engine) was not reproduced. It passed on rerun, and that module calls nothing that this change touched
