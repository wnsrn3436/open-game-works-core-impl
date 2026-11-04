# PaymentCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/payment_core/payment_core.gd:451 | D1. The epoch checks at lines 412, 443 and 451 of `_run_purchase` are not reached by any test with a session change before them. `client/godot/core/payment_core/tests/test_purchase.gd:92` changes the session only while `finish` is held (after the `VerifyPurchase` response), so only lines 456 and 460 are exercised. No `log_in` in `tests/` runs during `CheckPurchase`, `buy` or `VerifyPurchase`. The code and tests are unchanged since the debt was written (`git log` of `client/godot/core/payment_core`: only f54bf0d, a comment at line 674) | Add tests that change the login session while `CheckPurchase` is pending, while `buy` is held (`fake_hold_buy`), and while `VerifyPurchase` is pending, and assert `Rejected`, no `buy` / no `VerifyPurchase` / no `finish` respectively | no | 90 |
| R1-2 | test evidence | medium | client/godot/core/payment_core/payment_core.gd:659 | D2. No test changes the session while `list_unfinished` or `list_owned` is running, so the check at line 659 is not exercised. `client/godot/core/payment_core/tests/test_recovery.gd:155` changes the session after `RecoverPurchase` was sent (line 680 path) | Add a test that holds `list_unfinished` (and `list_owned`), changes the session, releases it, and asserts no `RecoverPurchase` is sent and the result is the failure value | no | 88 |
| R1-3 | test evidence | medium | client/godot/core/payment_core/payment_core_node.gd:18 | D3. `grep SessionEnded` over `client/godot/core/payment_core/tests/` finds nothing; every session change in the tests is `log_in`. `open-game-works-core/skills/client-core/modules/payment-core.md:146` and `:159` require `SessionEndedEvent` to empty the `finish` success list and reset the `GOOGLE` restore flag | Add a test that publishes `SessionEndedEvent` (end the session through AuthCore) and asserts `_finished` is emptied, a pending result is discarded, and `GOOGLE` restores again in the next session | no | 88 |
| R1-4 | test evidence | medium | client/godot/core/payment_core/payment_core.gd:525 | D4. No test runs two `recover_purchases` at once: `start_recover()` is used once per test (`tests/test_recovery.gd:114`, `:160`, `tests/test_plugin_adapter.gd:77`), and each other call is awaited before the next. Lines 525 to 529 (`open-game-works-core/skills/client-core/modules/payment-core.md:144`, "returns that one's result") are not exercised | Add a test with two concurrent `recover_purchases` that asserts one `list_unfinished` call and the same success flag and `RecoverySummary` for both | no | 88 |
| R1-5 | test evidence | medium | client/godot/core/payment_core/payment_core.gd:893 | D5. `not TimeCore.is_synced()` of `_pass_days_left` (`open-game-works-core/skills/client-core/modules/payment-core.md:168`) has no test: the tests read `TimeCore.is_synced` only in `tests/support/payment_test_case.gd:192` and `:201` to build server time, and no test reads a pass before the time sync | Add a test that holds a pass row with time not synced and asserts `get_pass_days_left` 0, `is_owned` and `can_claim_daily` `false` | no | 87 |
| R1-6 | spec | medium | client/godot/core/payment_core/payment_core.gd:858 | D7. `claim_daily` (lines 851 to 858) keeps only `_life` and returns `claimed.ok` without comparing `_login_epoch`. Run path from the debt item: hold `ClaimIapDaily`, `claim_daily`, `log_in` of another user, release a success response: returns `true`. `open-game-works-core/skills/client-core/modules/payment-core.md:160` ends it with the failure value `false` (API table `:41`) | Capture `_login_epoch` at the start and return `false` when it changed; add a test | no | 88 |
| R1-7 | spec | medium | client/godot/core/payment_core/payment_core.gd:434 | D8. After `buy` returns, lines 434 to 440 return `Cancelled`, `Pending` and `StoreFailed` before the first epoch check at line 443. Run path: `purchase` with a held `buy`, `log_in` of another user, `buy` ends `Cancelled` or `Pending`: the result is that status, not `Rejected` required by `open-game-works-core/skills/client-core/modules/payment-core.md:160` | Check `epoch != _login_epoch` right after `buy` returns (after line 431) and return `Rejected`; add tests | no | 87 |
| R1-8 | correctness | medium | client/godot/core/payment_core/payment_core.gd:601 | D9. `_restore` joins `_restore_wait` without comparing the session it started in. When a `GOOGLE` restore of session A is still running and session B's first `recover_purchases` ends, line 546 sets `_google_restored` to `true` and line 547 joins A's run, which ends at line 619 with `false` because the epoch changed; `list_owned` is never run in session B, against the one restore per login session of `open-game-works-core/skills/client-core/modules/payment-core.md:146`. A `restore_purchases` of content code in session B also gets A's discarded result. `:161` ("does not start a new one") makes the join literal, so the two lines conflict for this run order | Decide in the spec that a run of an ended session is not shared (a new session starts its own run), then make `_restore` join only a wait of the same `_login_epoch` | yes | 85 |
| R1-9 | spec | medium | client/godot/core/payment_core/dev/payment_core_dev.gd:67 | D10. `open-game-works-core/skills/client-core/engines/godot.md:432` requires test code and DEV code to read fake adapter members through a `preload()` constant, not `class_name`. `payment_core_dev.gd` casts to `FakeStoreAdapter` (line 67) and reads and writes its members (`fake.next_buy_result` line 12, `fake.failing` lines 33 and 35). The test code does the same: `tests/support/payment_test_case.gd:25` and `:137` type `fake` as `FakeStoreAdapter`, and `tests/test_purchase.gd:285` and `tests/test_recovery.gd:225` read `fake.transactions` with `FakeStoreAdapter.Transaction` | Add a `preload("res://core/payment_core/dev/adapters/fake_store_adapter.gd")` constant in the DEV file and in the test support and use it for the casts, member access and `extends` | no | 85 |
| R1-10 | correctness | medium | client/godot/core/payment_core/payment_core.gd:525 | D11. `recover_purchases` joins `_recover_wait` without comparing the session. Run order (store `APPLE`): an unfinished `[iap_gems]`, `RecoverPurchase` held, `recover_purchases`, `log_in` of another user, `recover_purchases` again (the `BootstrapCore` `AfterLogin` call), held response released: the second call returns the first run's result, which line 544 ends with `false`, and nothing processes the transaction in the new session until the next foreground return or delivery retry. `open-game-works-core/skills/client-core/modules/payment-core.md:144` (share the run in progress) and `:160` (discard at end) together define this result | Decide in the spec that a recovery of an ended session is not shared, then join only a `_recover_wait` of the same `_login_epoch` (or start a new run after the discarded one ends) | yes | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `payment_core.gd` lines 412, 443, 451 and `tests/test_purchase.gd:92` are unchanged; no test changes the session before `finish` |
| D2 | open | R1-2 | `payment_core.gd:659` and `tests/test_recovery.gd:155` are unchanged; no test changes the session during `list_unfinished` or `list_owned` |
| D3 | open | R1-3 | No `SessionEndedEvent` in `client/godot/core/payment_core/tests/` |
| D4 | open | R1-4 | No test runs two `recover_purchases` at once |
| D5 | open | R1-5 | No test reads a pass before the time sync; the line is now `payment_core.gd:893` in `_pass_days_left` |
| D6 | fixed | none | `open-game-works-core/skills/client-core/modules/payment-core.md:147` now reads "(no screen. `NetworkCore` leaves the log)" (harness commit 23f8db7), which matches `open-game-works-core/skills/client-core/modules/network-core.md:106` and `:264`; the test item `:255` (one warn for `IAP_VERIFY_UNAVAILABLE`, a `ServerError` with callback `true`) also matches. The code comment at `payment_core.gd:674` states the same |
| D7 | open | R1-6 | `claim_daily` at `payment_core.gd:851` to `:858` still has no login session check |
| D8 | open | R1-7 | `payment_core.gd:434` to `:440` still return before the check at `:443` |
| D9 | open | R1-8 | `_restore` at `payment_core.gd:601` still joins a wait of any session, and line 546 sets `_google_restored` before the join |
| D10 | open | R1-9 | `payment_core_dev.gd:67` still casts to `class_name` `FakeStoreAdapter`; the test support does the same |
| D11 | open | R1-10 | `recover_purchases` at `payment_core.gd:525` still joins a wait of any session |

## must fix

none

## unknown

- The commit range is empty (`ce34b78..ce34b78`), so only the debt items were checked. The rest of PaymentCore (adapters, plugin store adapter, prepare, guest warning, subscription) was not reviewed again in this round
- The mutation runs and temporary-copy reproductions that the debt items describe were not run again. The `open` results rely on the code and tests being unchanged since those items were written: `git log` of `client/godot/core/payment_core` shows only f54bf0d after the initial commit, which changed the comment at `payment_core.gd:674`
- The PaymentCore test suite was not run in this round
