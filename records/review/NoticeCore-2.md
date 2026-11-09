# review NoticeCore round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | test evidence | medium | client/godot/core/notice_core/tests/test_lifecycle.gd:154 | The new test `test_release_before_init_drops_the_image_downloader` (commit 79823597) asserts `errors() == 0` and `warns() == 0` with the message "release before init leaves no log" (`:154`-`:155`), for the rule of `core/SKILL.md` `## lifecycle` that a `release` of a module that is not `init`ed leaves no log. These asserts cannot see a log of that `release`. `NoticeCore.release()` runs at `:148`, when `LogCore` is not initialized (the `after_each` of the previous test ran `_release_modules`, which ends with `LogCore.release()`, `notice_test_case.gd:287`). `LogCore._log` before `init` only prints to the console and returns before the listener (`client/godot/core/log_core/log_core.gd:234`-`:237`, as `log-core.md` sets: log operations before `init` write only to the console), so `UnitTestCore._collect` never gets the line and `check_logs` counts only the logs of `start()`. Reproduced: in a temporary worktree of 5839cd79, `notice_core.gd:129` was changed to `_downloader_override = null; LogCore.log_warn(_TAG, "release before init")`, and `ogw core test godot NoticeCore --file client/godot/core/notice_core/tests/test_lifecycle.gd` passed. | Initialize `LogCore` before calling `NoticeCore.release()` on the module that is not initialized (as `test_operations_before_init_log_errors` does at `:121`), then check `errors()` and `warns()` are 0 before `start()`; or drop the two asserts and their message | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit 79823597 adds `test_release_before_init_drops_the_image_downloader` (`client/godot/core/notice_core/tests/test_lifecycle.gd:144`): `set_image_downloader(d)` without `init`, `release`, then `start()` and checks that `_downloader_override` is `null`, `_downloader` is not `d`, `load_image` of a loopback HTTP image returns a texture and `d` got no `download`. Restored the defect in a temporary worktree (`git worktree add --detach` at 5839cd79) by replacing `client/godot/core/notice_core/notice_core.gd:129` `_downloader_override = null` with `pass`; `ogw core test godot NoticeCore --file client/godot/core/notice_core/tests/test_lifecycle.gd` failed in that test (`_downloader_override` was `d` not `null`, `_downloader` was `d`, `load_image` returned `null`, `d.urls.size()` was 1, then the 30000 ms test time limit). The part of the R1-1 fix about the log is not met by this test and is written as R2-1 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only change of the commit range under `client/godot/core/notice_core/` is the new test of `test_lifecycle.gd:144`-`:169`. `notice_core.gd` and its other files did not change in the range and were not reviewed again
- The range also changes `AuthCore` code and tests of other modules (`AdCore`, `NetworkCore`, `PaymentCore`, `PushCore`, `RealtimeCore`, `NativeUiCore`, `BootstrapCore`) and server core `iap` and `item-ledger` tests. NoticeCore does not call `AuthCore`, and the code of the modules NoticeCore calls did not change in the range; those changes were not reviewed
- The whole NoticeCore suite and the `--web` run were not run in this review; only `test_lifecycle.gd` was run, on the two restored copies described above
