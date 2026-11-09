# review PaymentCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/payment_core/payment_core.gd:126 | Commit ad967246 adds `_adapter = null` to `release` of a PaymentCore that is not `init`ed. This implements the lifecycle rule of `core` SKILL.md:73 (a `release` before `init` deletes the values set by operations called before `init`; for PaymentCore that is `set_store_adapter`, payment-core.md:44, and the fake adapter that the DEV operations of `PaymentCoreDev` drive). No PaymentCore test checks it. Every `set_store_adapter` call in the tests (tests/support/payment_test_case.gd:143, :154, tests/test_adapter.gd:10, tests/test_plugin_adapter.gd:28, tests/test_prepare.gd:139) is followed by `PaymentCore.init()` in the same test. Every `PaymentCore.release()` call (tests/test_lifecycle.gd:10, :58, :95, :110, :122, tests/test_plugin_adapter.gd:114, :128) runs on an `init`ed module, which goes through `_clean_up`. The new BootstrapCore test (client/godot/core/bootstrap_core/tests/test_boot_shutdown_pre_init.gd) covers only DataCore and ResourceCore. So deleting line 126 fails no test: run path `PaymentCore.set_store_adapter(FakeStoreAdapter.new(APPLE))` → `PaymentCore.release()` → `PaymentCore.init()` → `PaymentCore.is_supported()` returns `true` instead of `false`, and in the unit test runner the adapter of a test that ended before `init` reaches the next test through `BootstrapCoreDev.shutdown` | Add a PaymentCore lifecycle test: set a store adapter, call `release` without `init`, then `init`, and assert that `is_supported()` is `false`, `prepare()` is `false` and no PaymentCore log is left by the `release` | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the core tests or restore the defect in a separate worktree. R1-1 rests on reading every `set_store_adapter` and `release` call in client/godot/core/payment_core/tests and the BootstrapCore tests changed in the range
- In the commit range, only commit ad967246 changes PaymentCore code (client/godot/core/payment_core/payment_core.gd, +2 lines). The changes in that range to its dependencies (AuthCore storage and consent, NetworkCore and DataCore pre-init release, server `iap` gone subscription lookup) were read only where PaymentCore calls them or relies on them. The server `iap` change keeps the `CheckPurchase` and `VerifyPurchase` responses that PaymentCore reads (a gone lookup is returned as status `INVALID`), and it was not reviewed further: it is outside this target
- The same pre-init `release` changes of AdCore, NetworkCore, NoticeCore, PushCore, GameUpdateCore, NativeUICore and RealtimeCore in ad967246 are outside this target and were not checked for tests
