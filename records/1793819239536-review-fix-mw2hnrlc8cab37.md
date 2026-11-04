# review fix PushCore round 1

## done

- `PushCore` (Godot): fixed R1-1, R1-2, R1-3 of `records/review/PushCore-1.md`. No new public API, hook, event or core settings key
- No engine-specific implementation rules document was written, and `## godot build` of `tools/ogw.md` was not written
- Last `ogw core test godot BootstrapCore PushCore QACore UnitTestCore` and the same run with `--web`: all four modules `pass` (`ogw core dependents PushCore` lists client `BootstrapCore PushCore QACore UnitTestCore`, no server module). `ogw code check core`: type check, lint, dependency, secret all `pass`
- Test support: `tests/support/silent_notification_plugin.gd` became `tests/support/scripted_notification_plugin.gd` (same `.uid`). Its defaults (`read_state`, `request_state` = -1) keep the old never-ending behavior for `test_plugin_waits.gd`; a test can set the result of reads and requests (0, 1, 2), make `start_*` return 0 (`cannot_start`), and read the `schedule_local`, `cancel_local`, `cancel_all_local` calls. `tests/support/scripted_push_plugin.gd` got `cannot_start` (`start_token_request` returns 0, `token_state(0)` stays 0)

## spec proposals

none

## review

- R1-1: fixed. client/godot/core/push_core/push_core.gd:183. When the permission request screen result arrives, `request_permission` takes a new read number (`serial = _next_serial()`) and caches the result, so a read that started before that result (e.g. at `AppForegroundReturnedEvent` while the screen was open) cannot replace it, and a read that starts later can. Tests in client/godot/core/push_core/tests/test_permission.gd, which use `NativeNotificationAdapter` over the scripted plugin, whose request screen waits until the test sets `request_state`:
  - `test_a_screen_result_that_ends_after_a_foreground_return_read_is_cached`: a foreground return read ends `Undetermined` while the screen is open, then the user picks Allow. The caller and `get_permission` give `Granted` and `schedule_local` schedules. A later foreground read (`Denied`) replaces it
  - `test_a_read_that_starts_before_the_screen_result_and_ends_after_it_leaves_the_cache`: the foreground read is still running when the screen ends `Denied`. When the read later ends `Undetermined`, the cache stays `Denied`
  - With the fix reverted, both tests fail (8/10 passed)
- R1-2: fixed. client/godot/core/push_core/adapters/native_notification_adapter.gd:37 (`read_permission`) and :48 (`request_permission`) return `UNDETERMINED` at once when `id <= 0`. client/godot/core/push_core/adapters/native_push_adapter.gd:43 (`get_device_token`) returns `""` at once. None of them waits, reads the state or makes a cancel call. Tests in client/godot/core/push_core/tests/test_plugin_waits.gd:
  - `test_a_token_request_that_cannot_start_gives_no_token_at_once`: no token wait is left without a clock advance, no `token_state` read, no `cancel_token_request`, no `RegisterPushToken`
  - `test_permission_operations_that_cannot_start_end_undetermined_at_once`: `request_permission` ends `Undetermined` within 2 frames with no time advance, with no `permission_state` read and no `cancel_permission`
  - With the checks removed, both tests fail (4/6 passed)
- R1-3: fixed. New tests in client/godot/core/push_core/tests/test_real_adapters.gd, using the scripted `OgwNotification` plugin:
  - `test_native_notification_adapter_gives_the_permission_the_plugin_read`: plugin read 1 → `Granted`, 2 → `Denied`, on android and ios, for the `init` read (`get_permission`) and `request_permission`, with no screen
  - `test_native_notification_adapter_gives_the_result_of_the_plugin_request_screen`: read 0 → `Undetermined`. Screen 1 → `Granted`, 2 → `Denied`, 0 → `Undetermined`, both as the return value and in the cache
  - `test_native_notification_adapter_schedules_and_cancels_local_pushes_through_the_plugin`: the id, title, body and delay the plugin received for `schedule_local` and `schedule_local_after`, the id of `cancel_local`, one `cancel_all_local`, and a plugin `false` → `false` with one error log
  - With the `state == 1` / `state == 2` branches swapped, 3 tests fail (5/8 passed)

## unverified

- Godot engine leak, worked around but cause not found: the first form of the R1-1 fix wrote the static var `_read_serial` directly in `request_permission` after the screen resumed it (`_read_serial += 1`, or `_read_serial = _read_serial + 1`). On Godot 4.7.2 that leaked one `GDScriptFunctionState` per call at exit (`Leaked instance: GDScriptFunctionState ... Orphan StringName: request_permission`, seen with `--verbose` on a scratch copy of the project). The leak happened every run, only when the request really waited frames and then ended with a result, and the code without that write did not leak. Writing the number through a helper, `_next_serial()` (push_core.gd:204), does not leak, and `ogw core test` passes with it. The engine-level cause was not found: a minimal static coroutine script outside the core project did not leak. The helper's doc comment records this
- The behavior of the real `ogw-notification`, `ogw-push-fcm` and `ogw-push-apns` plugins when an operation cannot start (what they return from `start_*` and from `permission_state(0)` / `token_state(0)`) was not checked. Their source is not written yet, and the tests use scripted plugins that follow the interface in `## godot`
