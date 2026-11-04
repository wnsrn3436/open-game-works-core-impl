# review PushCore round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Scope of this round: the commit range `6786a7f..2277ae7` changes no file under `client/godot/core/push_core/`, `core-spec/`, `proto/`, `fixtures/`, `test-data/`, `client/godot/plugins/`, `client/godot/engine.json`, `settings/core-settings.json` or `server/core/push/`, and no file of a client module that PushCore depends on (`LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `LocalizationCore`, `DataCore`, `NetworkCore`, `AuthCore`) or of `BootstrapCore`, which passes its adapters. The only client code it changes is `client/godot/core/realtime_core/`, which is not a dependency of PushCore. Input `## spec changes` is `none`.
- The changed files that could reach PushCore do not reach it: `settings/core-settings.schema.json` changes no `PushCore.*` or `push.*` entry, and `PushCore.permissionReadTimeoutMs` already has schema `minimum` 1, as the spec states. `server/core/routing/tests/settings-minimum.test.ts` names `push.leaseMs` only in its list of server keys left at their default, and it reads only server specs. `server/core/auth/deps.ts` moves `block-report` to `FallibleRemoveUser` and leaves `push` as `RemoveUser`. `server/core/auth/tests/withdraw.test.ts` does not name push in its changes.
- Tests not run: no PushCore test, core test or server test was run in this round, because the range does not change the target and there was no finding to check. No defect was restored in a temporary copy.
- Read outside the range, for possible `## out of scope` lines: `client/godot/core/push_core/push_core.gd`, `push_core_node.gd`, `push_token_wait.gd`, `push_consent_info.gd`, all files in `adapters/`, `dev/` and `dev/adapters/`, `tests/test_registration.gd`, `tests/test_permission.gd`, `tests/test_local_push.gd`, parts of `tests/test_remote_push.gd` and `tests/test_lifecycle.gd`, `_pass_push_adapter` and `_pass_notification_adapter` of `client/godot/core/bootstrap_core/bootstrap_core.gd`, and `get_consent`, `update_push_consent`, `is_logged_in` of `client/godot/core/auth_core/auth_core.gd`. This reading was not a whole-target review, and it gave no new problem of severity `medium` or higher with a reproducing path.
- A path read and found to cause no problem: a logout during the wait for `get_device_token` reaches `_send_token` with no session, and `NetworkCore` discards a request in the session end state without sending it (`open-game-works-core/skills/client-core/modules/network-core.md:138`). This comes from reading the code and the spec; it was not run.
- Not read: `tests/test_consent.gd`, `tests/test_real_adapters.gd`, `tests/test_plugin_waits.gd`, the files in `tests/support/` and `tests/resources/`, and the implementation of the depended-on modules beyond the operations named above. The `test evidence` aspect was not checked for those tests, and no mutation was run on any PushCore test.
- Not checked: the plugin side of the adapter contract. `client/godot/plugins/` has no `ogw-push-fcm`, `ogw-push-apns` or `ogw-notification` source, which `open-game-works-core/skills/client-core/engines/godot.md` allows until a human orders those plugins, and the behavior of the real OS services could not be read here.
- Not judged: the three items of `records/review-debt/PushCore.json` (D1, D2, D3). Input `## debt` is `none`, so this review does not have them in scope. Their code did not change in the range, so this review gives no evidence that they are fixed, and they are not written again in `## out of scope`.
