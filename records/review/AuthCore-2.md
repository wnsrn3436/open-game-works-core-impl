# AuthCore review round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | client/godot/core/auth_core/auth_core.gd:1405 | Commit e5dbcc41 adds `or removed == null` to `_block_age`, which now returns right after the storage-remove wait. By that point `_block_age` has already set `_session = null` and cleared the pending token (auth_core.gd:1401-1403). `_end_session(AGE_BLOCKED)` (auth_core.gd:1413) is now skipped, so `_provider` stays set, `NetworkCore.set_session_provider(null)` and `LogCore.set_analytics_allowed(false)` are not called, and no `SessionEndedEvent(AgeBlocked)` is published. Its caller `prepare_consent` (auth_core.gd:1193-1194) then returns `ConsentResult.AGE_BLOCKED`, not its failure value `Failed`. Run path: log in, then `prepare_consent` with a `ConfirmAge` response whose `consent.below_minimum_age` is `true`, while the fake storage holds the remove (`env.storage.hold = true`). Call `AuthCoreDev.clear_dev_values()` while that remove waits (AuthCore stays initialized, so `_life` does not change). `_end_storage_waits` (auth_core.gd:1027) ends the wait, `_storage_call` returns `null`, and `_block_age` returns. Result: `prepare_consent` gives `AgeBlocked`, `is_logged_in()` is `false`, NetworkCore still holds the AuthCore session provider (every request then gets the `access token: no session` error from `_provide_access_token`, auth_core.gd:860-862), and analytics stays allowed. This breaks auth-core.md `### age and privacy choices` step 2 (session provider none, `SessionEndedEvent(AgeBlocked)`) and the `clear_dev_values` DEV row ("the async operations of callers waiting for them end as failures, as on `release`"). Before e5dbcc41, the same run left an error log and still ended the session. On `release` the behavior did not change, because `release` clears the provider itself. No test covers `clear_dev_values` during the age-block remove | In `_block_age`, when the wait was ended while `life == _life`, do not leave the half-ended session. For example, do the in-memory session end (`_end_session(AGE_BLOCKED)` or at least the provider, NetworkCore and analytics reset) before or regardless of the storage-remove wait. Have `_block_age` report the ended wait so that `prepare_consent` returns `Failed`. Add a test that calls `clear_dev_values` during the age-block remove | no | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `_storage_call` returns `null` for a wait that `release` or `clear_dev_values` ended (auth_core.gd:1014-1015). `_run_storage` maps an adapter `null` outcome to `FAILED` (auth_core.gd:1049-1050), so `null` only means an ended wait. The auto-login write (auth_core.gd:452-453) and `link_account` (auth_core.gd:1518-1520) now return `Failed` with no pending token and no log. New tests in client/godot/core/auth_core/tests/test_storage.gd: `test_clear_dev_values_during_the_auto_login_write_fails_boot_login_without_a_pending_token` asserts `FAILED`, no session and no error log, where the old code gave `Success`. `test_clear_dev_values_during_the_link_account_write_fails_the_link_without_a_log` asserts `LinkStatus.FAILED` and no error log, where the old code gave `SUCCESS` with an error log. The new defect that the same change causes in `_block_age` is R2-1 |
| R1-2 | fixed | client/godot/core/auth_core/tests/test_lifecycle.gd:108 `test_release_before_init_deletes_the_pre_init_values_and_keeps_the_dev_values_and_the_pending_token` releases AuthCore before `init`. It asserts that `_storage_scope` is empty, that `_social_adapters` and `_test_storage` are empty, that the fake account, the fake tracking, `_dev_storage` and the pending tokens remain, and that there is no storage call and no error or warn log. Deleting the `_clear_pre_init_values()` call fails the scope and adapter asserts. Making it also delete the fake account or the pending token fails the matching asserts |
| R1-3 | fixed | The commit message of e5dbcc41 (`git log -1 --format=%B e5dbcc41`) gives the cause and the evidence of both rule changes. e6caa1ef: cause, the QACore `set_social_account` restart; evidence, auth-core.md:240 and the DEV table. ad967246: cause, pre-init values leaking through BootstrapCore DEV shutdown; evidence, core SKILL.md:73 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the Godot core tests. R2-1 comes from reading the code path `clear_dev_values` → `_end_storage_waits` → `_storage_call` → `_block_age` → `prepare_consent`; I wrote no test for it. The result is the same whether Godot resumes the awaited `done` signal synchronously or deferred
- R1-1 and R1-2 are `spec` findings, so I did not restore the defects in a worktree. I judged the new tests by their asserts against the old code paths
- `withdraw` and `logout` now leave the session open when `clear_dev_values` ends the remove wait. In `withdraw`, the server `Withdraw` has already succeeded and the terms keys have already been deleted. I did not judge this a finding: the DEV row requires a failure as on `release`, and no defining document sets the state after it
- I reviewed only the AuthCore files of the range (client/godot/core/auth_core/). I did not review client/godot/core/bootstrap_core/tests/test_boot_shutdown_auth_dev_values.gd (a BootstrapCore test) or the other modules of the range
- I did not check the real platform storage adapters (`ogw-secure-storage`, the web storage) with `clear_dev_values`
