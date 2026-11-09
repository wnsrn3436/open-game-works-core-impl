# review PushCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit 2f1e5e47 adds `client/godot/core/push_core/tests/test_lifecycle.gd:113` `test_release_before_init_deletes_the_adapters_set_before_init`. It sets a scripted push adapter (launch push 55) and a scripted notification adapter, calls `release` without `init`, checks that no error log is left, then `init`s without setting the adapters again and checks `_push`/`_notification` are null, `get_permission` is `UNSUPPORTED`, `take_launch_push` is 0 with the adapter's launch push untouched, and a login sends no `RegisterPushToken` with no `get_device_token` or `read_permission` call. Restored the defect in a `git worktree add --detach` worktree of 1e1285cb by deleting `_push = null` and `_notification = null` from `release` (client/godot/core/push_core/push_core.gd:88-89) and ran `ogw core test godot PushCore --file test_lifecycle.gd`: PushCore fail, that test failed on headless (adapters not null, permission 1 instead of 3, launch push 55 instead of 0, RegisterPushToken sent, token and read calls 1). With push_core.gd restored, the same run: PushCore pass |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `test_lifecycle.gd` of PushCore was run (on the restored defect and on the unchanged code). The other PushCore test files were not changed in the commit range and were not run
- The AuthCore changes in the range (storage waits ending as `null`, `_forget_account` returning a result) were read only where PushCore meets AuthCore (`get_consent`, `update_push_consent`, `is_logged_in`, `SessionEndedEvent` reasons); those paths are unchanged. The commit range changes no other PushCore file
- The real adapters (APNs, FCM, native plugins) were not changed in the range and were not read
