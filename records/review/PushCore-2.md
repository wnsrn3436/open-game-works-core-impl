# review PushCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | client/godot/core/push_core/push_core.gd:183-185: after the screen result arrives, `request_permission` takes a new number (`serial = _next_serial()`) and caches the result, so a read that started earlier (`_read_permission`, line 195-197) cannot replace it, and a read that starts later can. Defect restored in a temporary copy of the core Godot project in the session scratchpad (line `serial = _next_serial()` removed): client/godot/core/push_core/tests/test_permission.gd `test_a_screen_result_that_ends_after_a_foreground_return_read_is_cached` ("the screen result is newer than the read", 0 != 1) and `test_a_read_that_starts_before_the_screen_result_and_ends_after_it_leaves_the_cache` ("the older read leaves the screen result", 0 != 2) failed, 66/68 passed. With the code as committed, 68/68 PushCore tests passed |
| R1-2 | fixed | client/godot/core/push_core/adapters/native_notification_adapter.gd:37-38 (`read_permission`), :48-49 (`request_permission`) and client/godot/core/push_core/adapters/native_push_adapter.gd:43-44 (`get_device_token`) return the failure result at once when `id <= 0`, with no wait, no state read and no cancel call. Each check was removed on its own in the temporary copy: without the read check, test_plugin_waits.gd `test_permission_operations_that_cannot_start_end_undetermined_at_once` failed ("operation ID 0 is not read", 6 != 0); without the request check, the same test failed (3 != 0, and the request had not ended); without the token check, `test_a_token_request_that_cannot_start_gives_no_token_at_once` failed ("the token wait ended before the time limit", 1 != 0; 10 polls of ID 0) |
| R1-3 | fixed | client/godot/core/push_core/tests/support/scripted_notification_plugin.gd ends reads and requests with 0, 1, 2 and records `schedule_local`, `cancel_local`, `cancel_all_local`; client/godot/core/push_core/tests/test_real_adapters.gd has new tests that use it with `NativeNotificationAdapter`. Swapping the `state == 1` and `state == 2` branches of native_notification_adapter.gd:88-91 in the temporary copy made 5 tests fail (63/68 passed), among them `test_native_notification_adapter_gives_the_permission_the_plugin_read` and `test_native_notification_adapter_gives_the_result_of_the_plugin_request_screen`. Swapping `title` and `body` in the adapter's `schedule_local` call and dropping its `cancel_all_local` call made `test_native_notification_adapter_schedules_and_cancels_local_pushes_through_the_plugin` fail (67/68 passed) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same defect as R1-1: push_core.gd:183 takes a new number when the screen result arrives, and the two test_permission.gd tests above fail when that is removed |
| D2 | fixed | none | Same defect as R1-2: the three `id <= 0` checks are present, and each one's removal fails a test_plugin_waits.gd test |
| D3 | fixed | none | Same defect as R1-3: the branch swap that passed all tests in D3 now fails 5 tests, and the local push plugin calls are asserted |

## must fix

none

## unknown

- Tests ran on a copy of the core Godot project (`open-game-works-core-impl/client/godot` at b1dfb06, which has the same `core/` as this checkout) by running GUT directly with Godot 4.7.2 headless, without the `ogw core test` test host. GUT gave its results in the console (68/68 passing); the result file that would go to the test host was not sent. The `--web` run and the dependent modules (`BootstrapCore`, `QACore`, `UnitTestCore`) were not run again.
- The Godot leak described in the core agent report (`GDScriptFunctionState` leaked when `_read_serial` is written directly in `request_permission`) was not reproduced. The workaround through `_next_serial()` gives the same behavior, so it does not change any result above.
- Plugin source of `ogw-notification`, `ogw-push-fcm` and `ogw-push-apns` does not exist yet, so what the real plugins return from `start_*` and from `permission_state(0)` / `token_state(0)` was not checked.
- The commit range also changes server modules (e.g. `server/core/push/send.ts`). Those are not part of the PushCore target, and they were not reviewed.
