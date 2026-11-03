# review: PushCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/push_core/push_core.gd:182: medium `request_permission` drops the result of the OS permission request screen when a foreground read started while the screen was open, and the cache can then stay wrong until the next return from the background. `open-game-works-core/skills/client-core/modules/push-core.md:56` says it "caches and returns that result". Run path: the permission is `Undetermined`, content code calls `request_permission` (`_read_serial` becomes N, `serial` = N) and it waits in `adapter.request_permission` at line 179, which has no time limit. The user leaves the app and returns with the screen still open, so `AppForegroundReturnedEvent` calls `_read_permission` (`_read_serial` becomes N+1), and that read ends with `Undetermined` because the user has not answered. The user then picks Allow: the caller gets `Granted`, but `serial == _read_serial` at line 182 is false, so the cache stays `Undetermined`. `get_permission` gives `Undetermined` and `schedule_local` gives `false` without a log (`_schedule`, line 265) until the next return from the background. The serial guard is correct for an older read, but a request result is newer than any read that ended before it. No test under `client/godot/core/push_core/tests/` runs a foreground return during a pending request: `test_plugin_waits.gd:112` waits on a pending request with no return, and `test_permission.gd` uses an adapter that answers at once. This code is not in the range, so this existed before it

## debt

none

## must fix

none

## unknown

- The range `f3ac5b0..6d11fa6` changes only `client/godot/core/localization_core/localization_core.gd` (`_restore_heading_types`), `client/godot/core/localization_core/tests/test_font_weight.gd` and records. No file under `client/godot/core/push_core`, `core-spec/`, `server/`, `proto/`, `settings/`, `test-data/` or `tools/` changed. The reach into this target was checked by reading: `PushCore` calls only `LocalizationCore.get_text` and `LocalizationCore.get_language_code`, and its test support calls `LocalizationCore.release`, `init`, `resolve_language`, `select_language` and `load_translation`. No file under `client/godot/core/push_core` names a heading type, a theme or `load_fonts`. This finds no problem that the range causes or reveals in `PushCore`.
- The core tests were not run in this review, because there is no finding to check and this review does not edit code. `ogw core dependents LocalizationCore` lists `PushCore`. `records/1793718260785-update-core-mw0tjfw196b34a.md` and `records/1793719054821-review-fix-mw0u0gkl5c81ec.md` report that `ogw core test godot` and `godot --web` pass for `LocalizationCore` and its dependents, without naming `PushCore`.
- The `## out of scope` item was found by reading the code and was not run. The run path assumes that a real device can publish `AppForegroundReturnedEvent` while the OS permission screen stays open. The native plugin sources and the OS behavior were not checked on a device. The event order is read from `client/godot/core/time_core/time_core_node.gd` (`NOTIFICATION_APPLICATION_PAUSED` and `NOTIFICATION_APPLICATION_RESUMED`).
- The whole `PushCore` code and tests outside that reach were read only in part, as the range does not change them: `push_core.gd`, the adapters, the DEV code, `test_permission.gd` and the first part of `test_registration.gd` were read. `test_local_push.gd`, `test_remote_push.gd`, `test_consent.gd` and `test_real_adapters.gd` were not read. The native plugins `ogw-push-fcm`, `ogw-push-apns` and `ogw-notification` were not read.
- The code of server core `push` was not read. Only its spec was read, because no file of the range is on that side.
