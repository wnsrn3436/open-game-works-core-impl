# PaymentCore review round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-3 | fixed | New test `test_logout_empties_the_finish_list_and_resets_the_google_restore` (`client/godot/core/payment_core/tests/test_recovery.gd:207`) ends the session through `AuthCore.logout()` with a `Logout` response (`:219`–`:220`), so `AuthCore` clears the session before it publishes `SessionEndedEvent`. Restored the defect in a temporary worktree `worktrees/_core/review-tmp-PaymentCore-r3` at 1646bb4 by adding `if not AuthCore.is_logged_in(): return` after the `_is_initialized` check of `_on_login_session_changed` (`client/godot/core/payment_core/payment_core.gd:787`). `ogw core test godot PaymentCore --file client/godot/core/payment_core/tests/test_recovery.gd` failed on that test (`[1] expected to equal [0]: the logout empties the finish success list; the logout resets the GOOGLE restore`). `ogw core test godot PaymentCore` passes on unmodified 1646bb4 |
| R1-8 | open | `_restore` still joins any `_restore_wait` without comparing the login session (`client/godot/core/payment_core/payment_core.gd:601`–`:605`), and `recover_purchases` sets `_google_restored = true` before calling it (`:546`–`:547`). The core agent report left it unfixed because of the `spec change: yes` on the input line, but `open-game-works-core/skills/client-core/modules/payment-core.md:161` already says a run that started in an ended login session is not shared and the call starts its own run, so the fix is in code only and needs no further spec change |
| R1-10 | open | `recover_purchases` still joins `_recover_wait` without comparing the login session (`client/godot/core/payment_core/payment_core.gd:525`–`:529`). `open-game-works-core/skills/client-core/modules/payment-core.md:144` limits the share to a run "that started in the current login session", and `:161` makes the call of the new session start its own run. As with R1-8, the code differs from the current spec and the fix needs no further spec change |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | fixed | none | See R1-3: with the session-change handler ignoring a session end while `AuthCore.is_logged_in` is `false`, the new logout test fails |
| D9 | open | R1-8 | `client/godot/core/payment_core/payment_core.gd:601` is unchanged in the range and differs from `payment-core.md:146` and `:161`. Severity medium (differs from the defining documents; the wrong result needs a restore still running across a login session change) |
| D11 | open | R1-10 | `client/godot/core/payment_core/payment_core.gd:525` is unchanged in the range and differs from `payment-core.md:144` and `:161`. Severity medium (same reason as D9) |

## must fix

none

## unknown

- R1-8 and R1-10 are open based on reading the code, which has not changed at those lines since round 1 (the only PaymentCore change in the range is `tests/test_recovery.gd`). The temporary-copy reproductions of D9 and D11 were not run again
- Did not check whether a request still in flight at a real `AuthCore.logout()` ever ends, because that behavior belongs to NetworkCore and AuthCore. `test_session_end_discards_a_running_recovery_result` (`tests/test_recovery.gd:234`) still covers the held request with a published `SessionEndedEvent`
- Ran only `ogw core test godot PaymentCore`: on 1646bb4 it passes, and in the temporary worktree with the restored defect it fails on `test_recovery.gd`. The `--web` run and the tests of modules that depend on PaymentCore were not run
- Did not review again the parts of PaymentCore outside the range and the debt positions (prepare, guest warning, plugin store adapter, subscription sync)
