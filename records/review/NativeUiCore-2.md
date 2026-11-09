# review NativeUiCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit 5ef72d5e adds client/godot/core/native_ui_core/tests/test_lifecycle.gd:83 `test_release_before_init_deletes_the_adapter_without_logs`. It runs `start_modules(FakeNativeUiAdapter.new(), false)`, calls `NativeUiCore.release()` without `init`, and checks `_adapter` is null, no error and no warn log, then after `init()` checks `_adapter` is null, `request_review()` is `Unsupported`, `can_share()` is false, and no error and no warn log. Restored the defect in a `git worktree add --detach` checkout of 1e1285cb by replacing `_adapter = null` at client/godot/core/native_ui_core/native_ui_core.gd:93 with `pass`; `ogw core test godot NativeUiCore --file client/godot/core/native_ui_core/tests/test_lifecycle.gd` (job mw8phzsdb3ef2a) failed on this test: both `assert_null(NativeUiCore._adapter)` failed (the fake adapter was still there) and `request_review()` gave `Requested` (0), not `Unsupported` (2). The same command on the unchanged review checkout (job mw8pjy4ge73f2a) passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In the commit range, the only NativeUiCore change is the new test in client/godot/core/native_ui_core/tests/test_lifecycle.gd. The implementation (client/godot/core/native_ui_core/native_ui_core.gd), the adapters, NativeUiCoreDev and the test support (tests/support/native_ui_test_case.gd) did not change in the range. I read `init`, `release`, `request_review` and the test support again only as far as the new test calls them
- The other changes of the range (AuthCore, AdCore, NetworkCore, NoticeCore, PaymentCore, PushCore, RealtimeCore, BootstrapCore tests, server iap and item-ledger tests, records) do not touch NativeUiCore code: a grep of the range diff of client/ and server/ for `NativeUi` finds only the lines of the new NativeUiCore test. I did not review them, as they are outside this target
- I ran only test_lifecycle.gd of NativeUiCore, not the whole NativeUiCore suite or the dependents, and only headless (not `--web`). The core agent report says the full runs of NativeUiCore and its dependents passed, headless and `--web`
