# PaymentCore review round 9

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R9-1 | spec | medium | client/godot/core/payment_core/payment_core.gd:502 | The changed row at `open-game-works-core/skills/client-core/modules/payment-core.md:220` now says that when the login session ended, "the row of the step it waited on does not apply, except the log of a `prepare` it waited on", with log `none`. One of those steps is the guest warning popup (`:114`, row `:218`: popup cannot open → `Rejected`, `error`). `_guest_warning` (`payment_core.gd:497`-`503`) checks only `life` after `await UICore.open_system_popup` and logs `purchase: the guest warning popup did not open` without checking `_login_epoch`. `_run_purchase` (`:389`) checks the login session only after that. Run path: a guest with a usable social provider calls `purchase`. The system popup resource has open and close tween presets that are not loaded yet, so `open_system_popup` waits on their load (`ui_core.gd:530`-`540`). A new login (`LoginCompletedEvent`) or `SessionEndedEvent` ends the login session, and then `UICore.close_all_popups` runs (e.g. `SceneCore` scene change step 1, ShortcutCore). That cancels the open flow that is not visible yet, so `open_system_popup` returns `false` with no hidden callback (`ui-core.md:198`). The result is `Rejected`, but with a PaymentCore error log. Reproduced in a copy of the Godot core project (scratchpad) with a test that sets `UICore.systemPopupResource` to `prefab/ui_test_popup_late_tween`, starts a guest purchase, calls `log_in(USER_ID + 1, false)` (popup still not visible) and then `UICore.close_all_popups()`. It failed with `[1] expected to equal [0]` on `check_logs("error", "PaymentCore")`, and the log was `purchase: the guest warning popup did not open` from `payment_core.gd:502`. The same failure happened when `SessionEndedEvent` was published instead of the login. The same test without a session change logs that error once, as row `:218` requires | In `_guest_warning`, or in `_run_purchase` before `_guest_warning` logs, skip the "did not open" error log when the login session at the start of `purchase` has ended. Return a value that `_run_purchase` turns into `Rejected` with no log. Add a test that ends the login session while the guest warning popup loads its tween presets, then cancels it, and asserts `Rejected` and no PaymentCore error log | no | 90 |
| R9-2 | spec | medium | client/godot/core/payment_core/tests/test_recovery.gd:584 | The changed definition at `open-game-works-core/skills/client-core/modules/payment-core.md:164` sends `SyncSubscriptions` only after the transaction processing of a `list_unfinished` or `list_owned` that succeeded. No test asserts that no `SyncSubscriptions` goes out when the list fails in the current login session while a `SubscriptionUserState` exists. `test_subscription_sync_follows_the_processing_when_a_subscription_row_exists` (`:584`) covers only lists that succeed. `test_restore_is_true_when_list_owned_succeeds_and_false_without_verification_when_it_fails` (`:479`) has a failed `list_owned` but no `SubscriptionUserState`. The session tests at `:229` and `:256` cover only an ended login session. Checked in a copy of the Godot core project (scratchpad): `payment_core.gd:597` and `:640` were changed to send `SyncSubscriptions` (when `UserStateCore.count(SubscriptionUserState) > 0`) after the list failure log, before `return false`. Then `test_recovery.gd` (25), `test_subscription.gd` (8), `test_plugin_adapter.gd` (5), `test_prepare.gd` (12), `test_purchase.gd` (24), `test_guest.gd` (10), `test_lifecycle.gd` (9) and `test_adapter.gd` (2) were run. All passed | Add a test that applies a `SubscriptionUserState`, makes `list_unfinished` and then `list_owned` fail (`PaymentCoreDev.fake_set_fail`) in the current login session, and asserts `false` for `recover_purchases` and `restore_purchases`, one PaymentCore error log each, and `request_count(SYNC) == 0` | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R7-1 | fixed | Round 8 already marked it `fixed`, and the range `6bb95bc..75da433` changes no file under `client/godot/core/payment_core/`. `payment_core.gd:593` and `:636` still return `false` when `epoch != _login_epoch` after the list call, before the error logs at `:597` and `:640`. `test_recovery.gd::test_store_lists_that_fail_after_the_login_session_ended_log_no_error` (`:208`) is unchanged and passed in the scratchpad copy run of `test_recovery.gd` (25 of 25 passed) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range changes no PaymentCore code or test. This review compared the unchanged PaymentCore code and tests with the three hunks of the spec change diff: the subscription sync condition (`:164`), the new list failure row (`:211`) and the changed ended-session row (`:220`). For `:211`: `payment_core.gd:597` and `:640` log `error` and return `false` for a failure or time limit of `list_unfinished` and `list_owned`, which matches, and `test_recovery.gd:499` and `test_plugin_adapter.gd:88` assert one error log. For `:220`: the `prepare` error logs (`payment_core.gd:305`, `:318`) do not depend on the login session, which matches, and `test_purchase.gd:250` asserts the connect failure log of a `prepare` that a purchase of an ended session waited on. The other steps of `_run_purchase`, `_process_transaction`, `_finish_transaction` and `_verify_of` check `_login_epoch` before their logs. The guest warning step is the exception (R9-1)
- The tests ran in a copy of `open-game-works-core-impl/client/godot` (main checkout at `75da433`, the same commit as this checkout, with `addons/` and `.godot/`). A minimal local HTTP stub served as the test host. The stub's empty response made `PUT /result` fail, so the GUT exit code was 1, but every test in the GUT run summary passed. The render pass, the test files not named above and the test suites of other modules did not run
- No test was run where a scene change (`SceneCore` step 1) itself causes the `close_all_popups` of R9-1. The test called `UICore.close_all_popups` directly after the login
