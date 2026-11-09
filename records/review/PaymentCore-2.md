# review PaymentCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | client/godot/core/payment_core/tests/test_lifecycle.gd:103 `test_release_before_init_deletes_the_store_adapter` boots the modules without PaymentCore (`start_modules` in tests/support/payment_test_case.gd:68 does not init PaymentCore), sets a `FakeStore`, calls `PaymentCore.release()` before `init`, then `init`, and asserts `is_supported()` is `false`, `prepare()` is `false` with one `prepare: no store adapter` error, and that the adapter callback was not set. Restored the defect in a temporary `git worktree add --detach` of HEAD by replacing `_adapter = null` at client/godot/core/payment_core/payment_core.gd:127 with `pass`; `ogw core test godot PaymentCore --file client/godot/core/payment_core/tests/test_lifecycle.gd` failed on that test (the `is_supported`, `prepare` error count and adapter callback assertions). The same command passes on the target checkout |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In the commit range, the only PaymentCore change is the test added in client/godot/core/payment_core/tests/test_lifecycle.gd. I ran only that test file, with and without the restored defect. I did not run the whole PaymentCore suite or the suites of its dependents
- The AuthCore change in the range (client/godot/core/auth_core/auth_core.gd: storage outcome, `_write_item`, `_forget_account`) was read only to confirm that it does not change `is_logged_in`, `is_provider_supported` or `list_linked_providers`, the AuthCore operations PaymentCore calls. It was not reviewed further: it is outside this target
- The server `iap` change in the range is only a test (server/core/iap/tests/gone.test.ts) and was not reviewed: it is outside this target
