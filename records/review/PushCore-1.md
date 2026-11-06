# review: PushCore round 1

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

- The commit range 97851fcb..f560089e changes no file under client/godot/core/push_core/: it changes client/godot/core/ui_core/ (ui_core.gd, system_popup_view.gd and their tests), records/1793932803677-update-core-mw4d9u8t750c0d.md and records/review/*. PushCore code does not call UICore (grep of client/godot/core/push_core finds UICore only in tests/support/push_test_env.gd, which calls `UICore.init`, `UICore.prepare` and `UICore.release` for the test setup). The UICore change renames the deferred focus callable and adds `_focus_start_pending` and `_scroll_event`, all reset in `UICore._reset_statics`, and adds no PushCore-observable behavior, so no finding was found from the range.
- The PushCore core tests were not run by this review: no PushCore code or test changed in the range, and `ogw review run` runs the core tests of the modules that depend on a fixed target.
- Pre-existing PushCore code was read only in part, to look for `critical`, `high` or `medium` problems for `## out of scope`: push_core.gd, push_core_node.gd, push_token_wait.gd, adapters/native_push_adapter.gd, dev/adapters/fake_push_adapter.gd, and `AuthCore.get_consent` and `AuthCore.update_push_consent` in client/godot/core/auth_core/auth_core.gd. adapters/native_notification_adapter.gd, adapters/push_apns_adapter.gd, adapters/push_fcm_adapter.gd, dev/push_core_dev.gd, dev/adapters/fake_notification_adapter.gd and the tests under client/godot/core/push_core/tests/ were not read; problems in them are not judged by this review.
- The sign of `bias` of `Time.get_time_zone_from_system` used by `_timezone_offset_ms` (push_core.gd) on each host OS was not checked against the engine source.
