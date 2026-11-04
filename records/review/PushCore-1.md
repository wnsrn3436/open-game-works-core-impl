# review PushCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | client/godot/core/push_core/push_core.gd:182 | Input D1, still present: `request_permission` takes `serial` at line 174 before the read and the screen, and at line 182 caches the screen result only when `serial == _read_serial`. Run path: cache `Undetermined`, content code calls `request_permission`, which waits in `adapter.request_permission` (line 179, no time limit in `NativeNotificationAdapter.request_permission`, client/godot/core/push_core/adapters/native_notification_adapter.gd:45). A `TimeCore.AppForegroundReturnedEvent` while the screen is open runs `_read_permission` (line 193 raises `_read_serial`), which ends with `Undetermined`. The user then picks Allow: the caller gets `Granted`, but line 182 is false, so the cache stays `Undetermined`, and `_schedule` (line 265) returns `false` with no log until the next return from the background. open-game-works-core/skills/client-core/modules/push-core.md:56 says `request_permission` "caches and returns that result". No test runs a foreground return during a pending request: client/godot/core/push_core/tests/test_permission.gd uses `scripted_notification_adapter.gd`, whose `request_permission` returns at once | Treat the screen result as newer than any read that ended before it: take a new serial (`_read_serial += 1`) when the screen result arrives and cache it, so only a read that starts after it can replace it. Add a test with an adapter whose request waits until the test releases it, a foreground return (`UnitTestCore.advance_clock(..., true)`) while it waits, and an assert that `get_permission` is the screen result | no | 90 |
| R1-2 | correctness | medium | client/godot/core/push_core/adapters/native_notification_adapter.gd:44 | Input D2, still present: open-game-works-core/skills/client-core/engines/godot.md:59 sets operation ID 0 for "cannot start", but `request_permission` passes the ID of `start_request_permission` to `_wait_permission(plugin, id, -1)` without a check, so a plugin that returns 0 and answers `permission_state(0)` with -1 leaves `PushCore.request_permission` waiting until `release` (D2 reproduced this on a temporary copy: no end after 30 frames). The same missing check is at native_notification_adapter.gd:35 (read waits to `permission_read_timeout_ms` then calls `cancel_permission(0)`) and client/godot/core/push_core/adapters/native_push_adapter.gd:41 (waits to `token_timeout_ms` then calls `cancel_token_request(0)`). client/godot/core/auth_core/adapters/tracking_adapter.gd:33 and client/godot/core/native_ui_core/adapters/native_ui_plugin_adapter.gd:42 check `id <= 0` | After each `start_*` call return the failure result at once when `id <= 0` (`UNDETERMINED` for the permission operations, `""` for the token) with no wait and no cancel call; add plugin tests whose `start_*` returns 0 | no | 90 |
| R1-3 | test evidence | medium | client/godot/core/push_core/adapters/native_notification_adapter.gd:83 | Input D3, still present: the only `OgwNotification` test plugin, client/godot/core/push_core/tests/support/silent_notification_plugin.gd:26, always returns -1 from `permission_state`, and the other tests that construct `NativeNotificationAdapter` (client/godot/core/push_core/tests/test_real_adapters.gd:88-130) register no plugin. So no test reaches results 0, 1, 2 of `permission_state` (open-game-works-core/skills/client-core/engines/godot.md:63) or the adapter's `schedule_local`, `cancel_local`, `cancel_all_local` against a plugin. D3 swapped the `state == 1` and `state == 2` branches on a temporary copy and all PushCore tests passed | Add a scripted `OgwNotification` plugin that ends operations with 0, 1, 2 and records `schedule_local`, `cancel_local`, `cancel_all_local`, and assert the `PermissionStatus` that `PushCore.request_permission` and `get_permission` give for each and the arguments the plugin received | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | client/godot/core/push_core/push_core.gd:172-184 and 188-198 are as D1 describes; the commit range is empty and no test under client/godot/core/push_core/tests/ runs a foreground return during a pending request |
| D2 | open | R1-2 | client/godot/core/push_core/adapters/native_notification_adapter.gd:35, :44 and client/godot/core/push_core/adapters/native_push_adapter.gd:41 still pass the operation ID to the wait with no `id <= 0` check (grep for `id <= 0` in push_core/adapters finds nothing) |
| D3 | open | R1-3 | silent_notification_plugin.gd is still the only `OgwNotification` test plugin and returns only -1; no test asserts results 0, 1, 2 or the plugin calls of local push |

## must fix

none

## unknown

- The commit range a1ab038..a1ab038 is empty, so no changed code was reviewed; the review covered only the input `## debt` items.
- The PushCore core tests and the mutations of D2 and D3 were not run again in this round; the results above rest on the code being the same as when those items were written (empty range) and on reading the current code and tests.
- Plugin source of `ogw-notification`, `ogw-push-fcm` and `ogw-push-apns` (what `permission_state(0)` and `token_state(0)` return) was not checked.
