# PaymentCore review round 7

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R7-1 | spec | medium | client/godot/core/payment_core/payment_core.gd:597 | Input D12, still present. `_run_recovery` reads `epoch` at the start (`:584`), awaits `list_unfinished` through `_await_job` (`:590`), then checks only `life != _life` (`:593`). When the list failed or timed out, it calls `LogCore.log_error(_TAG, "recover_purchases: list_unfinished failed")` (`:597`) even when `epoch != _login_epoch`. `_on_login_session_changed` (`:793`) only raises `_login_epoch` and empties the maps, so nothing else stops this log. `_run_restore` has the same path for `list_owned` (`:633`, `:636`, `:640`). `open-game-works-core/skills/client-core/modules/payment-core.md:219` sets the log to none when the login session at the start of an async operation other than `prepare` has ended when that operation ends, and `:160` and `:161` say the old run's result is discarded. Run path read in the code (not run): `tests/support/holding_list_store_adapter.gd` holding `list_unfinished`, `PaymentCoreDev.fake_set_fail("list_unfinished", true)`, `recover_purchases()`, `log_in(USER_ID + 1)`, `release_lists()` → `recover_purchases` is `false` with one PaymentCore error log where the spec allows none. The same steps with `list_owned` and `restore_purchases` give `restore_purchases: list_owned failed`. The existing test `test_login_session_change_while_the_store_lists_run_discards_recovery_and_restore` (`tests/test_recovery.gd:180`) releases lists that succeed, so it does not reach this path | In `_run_recovery` and `_run_restore`, return `false` without a log when `epoch != _login_epoch` after the list call and before the failure log. Add a test that releases a failing held list after a login of another user and asserts zero PaymentCore error logs | no | 90 |

## previous

none. The review file of round 6 has no findings and no `open` rows

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D12 | open | R7-1 | `client/godot/core/payment_core/payment_core.gd:593`–`:597` and `:636`–`:640` are the same as when D12 was recorded: only `life` is checked before the list failure error log, so a list that fails after the login session ended still logs the error that `payment-core.md:219` forbids |

## must fix

none

## unknown

- The commit range `1b8ce0f..1b8ce0f` is empty, so no change was reviewed. The scope of this round is input D12 alone
- R7-1 was read in the code and not run. Running it needs a test file added to the target checkout or a copied project with a test host, and this review writes no file outside `output`
- `payment-core.md` has no row in its error table for a failed `list_unfinished` or `list_owned` in the same login session, and `:281` does not say whether that failure logs. Whether the same-session error log at `:597` and `:640` is allowed was not decided here. R7-1 covers only the ended-session case, which `:219` settles
- Parts of PaymentCore other than `_run_recovery`, `_run_restore` and `_on_login_session_changed` were not reviewed again
