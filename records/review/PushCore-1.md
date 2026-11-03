# review PushCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/push_core/push_core.gd:182: medium `request_permission` drops the result of the OS permission screen when a permission read starts while the screen is open, which differs from open-game-works-core/skills/client-core/modules/push-core.md:56 "then caches and returns that result". `_read_permission` raises `_read_serial` at `AppForegroundReturnedEvent`, so `serial == _read_serial` is false when the screen ends. Reproduced on a temporary copy: a notification adapter with read value `Undetermined` and a held screen; `request_permission`, then a return from the background, then the screen answers `Granted`. `request_permission` returned `Granted`, `get_permission` stayed `Undetermined`, and `schedule_local` returned `false` until the next return from the background. Two overlapping `request_permission` calls take the same path for the earlier call. Fix direction: a request result that ends after the read that started during its screen is cached, so that a read that ended before the answer does not overwrite it. No test has a read overlapping the screen
- client/godot/core/push_core/adapters/native_notification_adapter.gd:44: medium `request_permission` does not handle the operation ID 0 that open-game-works-core/skills/client-core/engines/godot.md:59 defines for "cannot start" and waits with no time limit (`_wait_permission(plugin, 0, -1)`). Reproduced on a temporary copy: a plugin whose `start_request_permission` returns 0 and whose `permission_state(0)` returns -1; `PushCore.request_permission` had not ended after 30 frames and 33 polls, and only `release` ended it. That document does not set `permission_state` of an ID that was not started, so the hang depends on the plugin. The same missing check is at client/godot/core/push_core/adapters/native_notification_adapter.gd:35 and client/godot/core/push_core/adapters/native_push_adapter.gd:41, where the wait ends only at the time limit and the adapter then calls `cancel_permission(0)` or `cancel_token_request(0)`. client/godot/core/auth_core/adapters/tracking_adapter.gd:33 and client/godot/core/native_ui_core/adapters/native_ui_plugin_adapter.gd:42 check `id <= 0`
- client/godot/core/push_core/adapters/native_notification_adapter.gd:83: medium `spec`/`test evidence`: no test reaches the `OgwNotification` results of `permission_state` (0, 1, 2) in open-game-works-core/skills/client-core/engines/godot.md:63, or `schedule_local`, `cancel_local`, `cancel_all_local` of `NativeNotificationAdapter` against a plugin. client/godot/core/push_core/tests/support/silent_notification_plugin.gd always returns -1, and the other tests that use this adapter have no plugin. Mutation on a temporary copy: swapping the `state == 1` and `state == 2` branches, so that a granted permission reads as `Denied`, left all 61 PushCore tests passing

## debt

none

## must fix

none

## unknown

- The commit range does not change `client/godot/core/push_core/`, core-spec/PushCore.json, the two PushCore settings or `local_push`. I read the changes of that range that reach PushCore or its dependencies (`LocalizationCore.list_languages`, `QACore` settings reads, core settings, data tool `corespec.ts` and `godotgen.ts`) and they do not touch what PushCore calls. All 61 PushCore tests passed with client/godot/core and generated of the reviewed commit, in a copy of the imported Godot project of the main checkout (commit 32aba7d) run directly through the GUT runner, not through `ogw core test`. The tests of modules that depend on PushCore were not run
- The `ogw-push-fcm`, `ogw-push-apns` and `ogw-notification` plugins do not exist yet (open-game-works-core/skills/client-core/engines/godot.md:54 leaves them to a later `update core`). Behavior on a real Android or iOS device was not checked: OS permission states, when `AppForegroundReturnedEvent` fires around the OS permission screen, `Time.get_time_zone_from_system` on a device. So how often the first item of `## out of scope` happens on a device is not known
- The sign of `timezone_offset_ms` is checked only against the same formula in client/godot/core/push_core/tests/support/push_test_env.gd:221, so it was compared with the Godot `bias` definition by reading, not by a test with a known time zone
- `BootstrapCore` adapter selection by build info `adapters` was only located, not reviewed. It belongs to the `BootstrapCore` target
