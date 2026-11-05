# PaymentCore review round 10

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R9-1 | fixed | `_guest_warning` keeps `_login_epoch` at its start (`client/godot/core/payment_core/payment_core.gd:490`) and writes `purchase: the guest warning popup did not open` only when `epoch == _login_epoch` (`:504`). `_run_purchase` captures the same epoch before the call (`:386`) and returns `Rejected` after `_guest_warning` when it changed (`:389`-`390`), so the row "the login session ... has ended" (`payment-core.md:220`, `Rejected`-type failure value, log `none`) now holds for this step, and the row "The guest warning popup cannot open" (`:218`, error) still holds for the current session (`test_guest.gd::test_guest_warning_that_does_not_open_is_rejected_without_check_or_buy`, `:96`, still asserts one error log). The new test `test_guest.gd::test_guest_warning_that_does_not_open_after_the_login_session_ended_is_rejected_without_an_error_log` (`:111`) passed. Defect restored in a scratch copy of the Godot core project: `if epoch == _login_epoch:` at `payment_core.gd:504` replaced by `if true:`. The new test then failed with `[1] expected to equal [0]: login: no guest warning error log; [1] expected to equal [0]: session end: no guest warning error log`; the other 10 tests of `test_guest.gd` passed |
| R9-2 | fixed | New test `test_recovery.gd::test_no_subscription_sync_after_a_store_list_that_fails_in_the_current_login_session` (`:602`) applies a `SubscriptionUserState`, makes `list_unfinished` and then `list_owned` fail in the current login session, and asserts `false`, one PaymentCore error log each, one call of each list and `request_count(SYNC) == 0`. It passed. Defect restored in the scratch copy: after the error logs of `payment_core.gd:600` (`list_unfinished failed`) and `:643` (`list_owned failed`), a `SyncSubscriptions` send was inserted when `UserStateCore.count(SubscriptionUserState) > 0`, before `return false`. The new test then failed with `[2] expected to equal [0]: no SyncSubscriptions after a failed list` (and `[0] expected to equal [1]` on the error log count after the unanswered sync); the other 25 tests of `test_recovery.gd` passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The tests ran in a scratch copy of `open-game-works-core-impl/client/godot` (the main checkout, whose `client/godot` has no diff from `82d82b4`, with its `addons/` and `.godot/`) overlaid with this checkout's `client/godot`. Each test file ran in its own headless GUT run (`-gtest=`) with the pre/post run hooks of `unit_test_core` and the harness test host (`tools/src/commands/check/lib/test-host.ts`). On the fixed code all PaymentCore test files passed: `test_guest.gd` 11, `test_recovery.gd` 26, `test_purchase.gd` 24, `test_prepare.gd` 12, `test_subscription.gd` 8, `test_plugin_adapter.gd` 5, `test_lifecycle.gd` 9, `test_adapter.gd` 2. PaymentCore has no `test_render_` files. The test suites of other modules and the web run did not run
- `payment_test_case.gd` change (`extra_resource_keys`, reset in `before_each`, merged in `start_modules`) was checked by the runs above; no other PaymentCore test sets it
- No test was run where a `SceneCore` scene change itself causes the `close_all_popups` of R9-1. The new test calls `UICore.close_all_popups` directly after the login session ends
