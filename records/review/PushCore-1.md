# review PushCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/push_core/push_core.gd:87 | Commit ad967246 makes `release` of a PushCore that is not initialized delete `_push` and `_notification` (lines 87-89). This follows the lifecycle rule in open-game-works-core/skills/core/SKILL.md:73, which `BootstrapCore` DEV `shutdown` now relies on (bootstrap_core.gd `_release_entry` calls `release` on modules that are not initialized). No test covers this behavior. The only callers of `PushCore.set_push_adapter` / `set_notification_adapter` in tests are push_test_env.gd:84-85 (`start_push`, always followed by `init`), test_lifecycle.gd:117-118 (after `init`) and qa_core/tests/test_optional_modules.gd:40 (followed by `init`). test_lifecycle.gd:95 calls `release` before `init` but only checks the log count, with no adapter set. test_boot_shutdown_pre_init.gd checks only `DataCore` and `ResourceCore`. Deleting lines 87-89 therefore fails no test. Run path that shows the behavior: `PushCore.set_push_adapter(FakePushAdapter.new())`, `PushCore.release()`, then dependencies `init` and `PushCore.init()`. With the fix, PushCore has no push adapter: `_push == null`, no `RegisterPushToken` on login, and `take_launch_push` returns `0` without calling the adapter. Without it, the adapter set before `release` stays active | Add a PushCore core test that sets a push adapter and a notification adapter, calls `release` without `init`, checks that no error log is left, then `init`s without setting adapters again and checks that `_push` and `_notification` are `null` (or the observable result: `get_permission` is `Unsupported` and a login sends no `RegisterPushToken`) | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The PushCore core tests were not run, on the original code or with lines 87-89 removed. R1-1 rests on reading every test caller of the two adapter setters, not on a test run
- The real adapters (APNs, FCM, native plugins) were not changed in the commit range and were not read
- The commit range touches no other PushCore file. The AuthCore changes in the range (storage waits, `clear_dev_values`, pre-init clear) were read only where they meet PushCore (`get_consent`, `update_push_consent`, `is_logged_in`, `SessionEndedEvent`); those paths are unchanged
