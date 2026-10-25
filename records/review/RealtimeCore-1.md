# RealtimeCore review round 1

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

- The commit range d4e2728fef95f1bcf36a696d7d54ff290185b73a..6c22ae6ee58f370047b08edb2ea039df9d48511d changes no RealtimeCore code, test or spec (`client/godot/core/realtime_core/` and `core-spec/RealtimeCore.json` are not in the diff), and no contract file. Of the modules in `## dependency` of the RealtimeCore spec, none changes in code: AuthCore changes only in its tests (`client/godot/core/auth_core/tests/test_account.gd`, `test_login.gd`, `test_terms.gd` drop `check_logs("error", "AuthCore")` asserts); the server `matchmaker` and `p2p-signaling` modules are not in the diff (only `records/review/matchmaker-1.md` changes)
- The RealtimeCore test setup (`client/godot/core/realtime_core/tests/support/realtime_test_case.gd:127`) initializes and releases `TweenCore` and `UICore`, which change in the range. The changes only add `TweenCore.get_finite_playing_count` (`client/godot/core/tween_core/tween_core.gd:328`) and `UICore.is_flow_in_progress` (`client/godot/core/ui_core/ui_core.gd:654`); neither `init`, `prepare` nor `release` changes, and RealtimeCore code and tests call neither new function. `ScreenEffectCore` and `QACore`, which also change, are not used by RealtimeCore code or tests
- `UnitTestCore` now sends `PUT /started` in the pre-run hook before the first test (`client/godot/core/unit_test_core/dev/unit_test_core.gd:943`, `client/godot/core/unit_test_core/dev/gut_pre_run.gd:15`). This runs once per GUT run before any test setup and does not touch the fake network or fake realtime transport that the RealtimeCore tests use (`create_fake_realtime`, `advance_clock`, `add_pending`, `set_test_settings`, `received_requests` are not changed in the range)
- The new core settings keys (`QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs`, `settings/core-settings.json:482`) and the renamed `uiQuality.settleLimitMs` (`client/godot/generated/core_settings.json:540`) are not read by RealtimeCore or its test setup
- The server `auth` changes (`server/core/auth/login.ts`, `server/core/auth/deletion.ts`) change only the failure handling of login transactions and web deletion; the RealtimeCore client tests use the fake network (`DevLogin` response from `add_login_result`, `realtime_test_case.gd:147`), so they do not reach that code
- Read only; the RealtimeCore tests were not run in this review
- RealtimeCore code and tests outside those paths were not reviewed: they are not changed in the range and are not reached by the changes, so their pre-existing problems are outside this review
