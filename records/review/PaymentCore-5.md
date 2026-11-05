# PaymentCore review round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | `client/godot/core/payment_core/payment_core.gd:586`–`:588` (`_run_recovery`) and `:629`–`:631` (`_run_restore`) return `false` when `epoch != _login_epoch` after `_prepare()`, before `list_unfinished` and `list_owned`. Tests `client/godot/core/payment_core/tests/test_recovery.gd:234` (no `list_unfinished` and no `list_owned` after a login during `connect`) and `:256` (spec `:289`: the later call waits for the same `prepare`, `connect` 1, `list_unfinished` 1, first `false`, later `true`) |
| R4-2 | fixed | `payment_core.gd:653`: `_process_all` returns `false` before the `SyncSubscriptions` send when `epoch != _login_epoch`, which also covers the empty-list path of the reproduction. Test `tests/test_recovery.gd:208` uses empty held lists, a `SubscriptionUserState` applied after each login, and checks `request_count(SYNC)` 0 for both recovery and restore |
| R4-3 | fixed | `payment_core.gd:389` (after the guest warning) and `:400` (after `_prepare()`) return `Rejected` when `epoch != _login_epoch`, before the choice or the prepare result is used. Tests `tests/test_guest.gd:68` (continue, link and cancel after a login each give `Rejected`, no `connect`, no `CheckPurchase`, no `buy`) and `tests/test_purchase.gd:228` (successful and failed `prepare` across a login both give `Rejected` without `CheckPurchase`. The failed one runs the `StoreFailed` path through `tests/support/hanging_store_adapter.gd:14`, which now returns `false` when `connect` is set to fail) |
| R4-4 | fixed | `tests/test_purchase.gd:181` uses `PaymentCoreDev.fake_hold_buy`, checks `Rejected`, no `VerifyPurchase`, no `finish`, no PaymentCore error or warn log, then one `RecoverPurchase` with that transaction's receipt (spec `:279`). `:204` releases `INVALID` and `OTHER_USER` after a login of another user and checks `Rejected`, no `finish`, no PaymentCore error or warn log (spec `:280`) |
| R4-5 | fixed | Tests added in `tests/test_recovery.gd`: `:362` (spec `:282`: call order `connect`, `query_prices`, `list_owned`; with `connect` failing, `false`, one error log, no second `list_owned`), `:276` (spec `:286`: old run sends no T2 `RecoverPurchase`, one `SyncSubscriptions` from the later run only, later summary `2,0,0,0,0,0`), `:337` (spec `:288`: no `list_owned` when the first ends, one after the later ends), `:256` (spec `:289`) |
| R1-8 | fixed | `payment_core.gd:803`: `_on_login_session_changed` sets `_restore_wait = null`, so `_restore` (`:604`) does not join a run of an ended session; `:618` clears `_restore_wait` only when it still holds its own wait, and `_google_restored` is set only when the recovery ends in its own session (`:548`). Test `tests/test_recovery.gd:310` (spec `:287`): `list_owned` 2 after the first recovery of the new session, the content restore joins the new restore, the old restore ends `false`, the content restore ends `true` with `0,1,0,0,0,0` |
| R1-10 | fixed | `payment_core.gd:802`: `_on_login_session_changed` sets `_recover_wait = null`, so `recover_purchases` (`:526`) of the new session starts its own run; `:540` clears `_recover_wait` only when it still holds its own wait. `_in_flight` is emptied at `:801`, so the new run is not skipped on a transaction the old run still processes (spec `:157` limits in-flight to the current login session). Tests `tests/test_recovery.gd:256`, `:276`, `:337` |

## out of scope

- client/godot/core/payment_core/payment_core.gd:597: medium When `list_unfinished` fails or times out after the login session at the start of `recover_purchases` has ended, `_run_recovery` checks only `life` (`:593`) and writes the error log `recover_purchases: list_unfinished failed`. `open-game-works-core/skills/client-core/modules/payment-core.md:219` says the log is none when the login session at the start of an async operation other than `prepare` has ended when that operation ends, and `:160` discards the result. The same path is at `:640` for `list_owned` in `_run_restore`. Run path read in the code (not run): `holding_list_store_adapter.gd` holding `list_unfinished`, `log_in(USER_ID + 1)`, the held list released with a failure → one PaymentCore error log. The list failure log has no row in the error table of `payment-core.md` for the same-session case either. This existed before the range

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D9 | fixed | none | Same fix as R1-8: `payment_core.gd:803` lets go of `_restore_wait` on a change of login session, `:548` sets `_google_restored` only after a recovery that ended in its own session, and the old run no longer clears the new run's slot (`:618`). The D9 sequence (restore held on `RecoverPurchase`, login of another user, recovery in the new session) now calls `list_owned` a second time, which `tests/test_recovery.gd:310` checks; a content `restore_purchases` of the new session joins the new run, not the old one (same test) |
| D11 | fixed | none | Same fix as R1-10: `payment_core.gd:802` lets go of `_recover_wait` on a change of login session and `:801` empties `_in_flight`, so the D11 sequence (`APPLE`, recovery held on `RecoverPurchase`, login, recovery again) runs a second `list_unfinished` and a second `RecoverPurchase` for the transaction and ends `true`. `tests/test_recovery.gd:276` checks `list_unfinished` 2, `RecoverPurchase` 3 for T1, T1, T2, the later run `true` and `finish` 2. The spec decision noted in D11 is settled by `payment-core.md:161` |

## must fix

none

## unknown

- No test was run in this round. The pass of the PaymentCore suite and its dependents is taken from the core agent report (`records/1793862560123-review-fix-mw37g9yz11bbb6.md`), and `ogw review run` runs the dependent core tests after each fix. No previous finding is a `test evidence` finding, so no defect was restored in a temporary copy. The results above come from reading the code and the new tests
- The out-of-scope list-failure log was read in the code and not run
- Of the commit range, only `client/godot/core/payment_core/` changed for PaymentCore. The other changed files in the range (server modules, other client modules, review records) were not reviewed. PaymentCore has no server dependents
- Parts of PaymentCore that the range did not change and that no previous finding or debt item points to (plugin store adapter, subscription and pass lookup, daily claim, price fetch) were not reviewed again
- The value stored in `_in_flight` (`payment_core.gd:676`) is never read; only the keys are used. This is `low` and not written as a finding in a range review
