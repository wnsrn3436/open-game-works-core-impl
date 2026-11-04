# PaymentCore review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Three tests added in `client/godot/core/payment_core/tests/test_purchase.gd` (`test_login_session_change_during_check_purchase_rejects_without_buy`, `test_login_session_change_during_buy_rejects_without_verify_for_every_buy_result`, `test_login_session_change_during_verify_purchase_rejects_without_finish`). Restored each defect in a temporary worktree `worktrees/_core/review-tmp-PaymentCore-m<n>` at f4d24ea and ran `ogw core test godot PaymentCore`: (1) `if life != _life or epoch != _login_epoch:` after `CheckPurchase` (`payment_core.gd:412`) changed to `if life != _life:` → the CheckPurchase test failed (`[1] expected to equal [0]`, `buy` was called); (2) the epoch check after `buy` (`payment_core.gd:432`–`:433`) removed → the buy test failed for every `buy` result (`VerifyPurchase` sent, a buy error log, time limit); (3) the epoch part of the check after `VerifyPurchase` (`payment_core.gd:451`) removed → the VerifyPurchase test failed (`finish` count `[1] expected to equal [0]`) |
| R1-2 | fixed | `test_login_session_change_while_the_store_lists_run_discards_recovery_and_restore` (`tests/test_recovery.gd:179`). Restored the defect by removing `if epoch != _login_epoch: return _OUTCOME.Processed.DISCARDED` at the start of `_process_transaction` (`payment_core.gd:659`–`:660`) in a temporary worktree: the test failed (`no RecoverPurchase for a listed transaction`: `[2] expected to equal [0]`) |
| R1-3 | open | The test added for it, `test_session_end_empties_the_finish_list_discards_a_running_result_and_resets_the_google_restore` (`tests/test_recovery.gd:207`), publishes `SessionEndedEvent` itself at `:225`–`:227` while `AuthCore` still holds the session. The defect that D3 names was restored in a temporary worktree (`if not AuthCore.is_logged_in(): return` added at the top of `_on_login_session_changed`, `payment_core.gd:787`) and `ogw core test godot PaymentCore` still passed. A session end through `AuthCore._end_session` (`client/godot/core/auth_core/auth_core.gd:1613`, used by logout and session expiry) sets `_session = null` before it publishes the event, so that defect keeps the `finish` success list and the `GOOGLE` restore flag across a logout while every test passes. Fix direction: end the session through `AuthCore` (e.g. `AuthCore.logout()` with a `Logout` response) for the `_finished` and `_google_restored` asserts; the held-request part can stay on the published event |
| R1-4 | fixed | `test_concurrent_recover_purchases_share_one_run` (`tests/test_recovery.gd:246`). Restored the defect by removing the join at `payment_core.gd:525`–`:529` in a temporary worktree: the test failed (`the second call joins the running one`: `[2] expected to equal [1]`, and the two `RecoverySummary` differ) |
| R1-5 | fixed | `test_pass_reads_zero_before_the_time_sync` (`tests/test_subscription.gd:130`). Restored the defect by removing `or not TimeCore.is_synced()` at `payment_core.gd:894` in a temporary worktree: the test failed (`[100000] expected to equal [0]: not synced`) |
| R1-6 | fixed | `claim_daily` keeps `_login_epoch` (`payment_core.gd:855`) and returns `life == _life and epoch == _login_epoch and claimed.ok` (`:859`). Restored the defect (epoch dropped from the return) in a temporary worktree: `test_login_session_change_during_claim_daily_is_false` (`tests/test_subscription.gd:147`) failed (`the claim of the ended login session`) |
| R1-7 | fixed | The epoch check now runs right after `buy` returns (`payment_core.gd:432`), before the `Cancelled`, `Pending` and `StoreFailed` returns; nothing is awaited between it and `VerifyPurchase`, so dropping the later check keeps the `Success` path covered. Restored the defect (check removed) in a temporary worktree: the buy test of R1-1 failed for `Cancelled`, `Pending` and `Failed` (`buy 1`, `buy 2`, `buy 3` asserts) |
| R1-8 | open | `_restore` still joins `_restore_wait` of any login session (`payment_core.gd:601`–`:605`), and `recover_purchases` sets `_google_restored = true` before calling it (`:546`–`:547`). The spec now settles the case: `open-game-works-core/skills/client-core/modules/payment-core.md:161` (harness commit 52e5ea3) says a run of an ended login session is not shared and the call starts its own run, so the fix needs no further spec change |
| R1-9 | fixed | `dev/payment_core_dev.gd:6` reads the fake through `const _FAKE := preload(...)`, `tests/support/payment_test_case.gd:6` through `FakeStore`, and every test support adapter extends the script path. `grep FakeStoreAdapter` over `client/godot/core/payment_core/` finds only the `class_name` line and `tests/test_adapter.gd:19`/`:23`, which read no member (`resource_path` and `get_global_name` of the `Script`), as `open-game-works-core/skills/client-core/engines/godot.md:432` allows |
| R1-10 | open | `recover_purchases` still joins `_recover_wait` without comparing the login session (`payment_core.gd:525`–`:529`). `open-game-works-core/skills/client-core/modules/payment-core.md:144` now limits the share to a run "that started in the current login session" and `:161` makes a call of the new session start its own run, so the code differs from the spec and the fix needs no further spec change |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | See R1-1: each of the three restored epoch checks makes one new test fail |
| D2 | fixed | none | See R1-2: removing the check at `payment_core.gd:659` makes the new store-list test fail |
| D3 | open | R1-3 | The defect D3 names (ignore the session change when `AuthCore.is_logged_in` is `false`) was restored and all PaymentCore tests passed |
| D4 | fixed | none | See R1-4 |
| D5 | fixed | none | See R1-5 |
| D7 | fixed | none | See R1-6 |
| D8 | fixed | none | See R1-7 |
| D9 | open | R1-8 | `payment_core.gd:601` unchanged; differs from `payment-core.md:146` and `:161` |
| D10 | fixed | none | See R1-9 |
| D11 | open | R1-10 | `payment_core.gd:525` unchanged; differs from `payment-core.md:144` and `:161` |

## must fix

none

## unknown

- The open results of R1-8 and R1-10 were read from the code, which is unchanged at those lines since round 1; the temporary-copy reproductions of D9 and D11 were not run again
- The core agent report says a real `AuthCore.logout()` left a held `RecoverPurchase` unended until the 30 s test limit (NetworkCore logged "AuthCore: access token: no session"). Whether a request in flight at a logout ends in production was not checked: it belongs to NetworkCore and AuthCore. If it never ends, `_recover_wait` would stay set and, with the join of R1-10, block later recoveries; not reproduced
- `ogw core test godot PaymentCore` was run on f4d24ea (pass) and on eight temporary worktrees with one restored defect each; the `--web` run and the tests of modules that depend on PaymentCore were not run
- Parts of PaymentCore outside the range and the debt positions (prepare, guest warning, plugin store adapter, subscription sync) were not reviewed again
