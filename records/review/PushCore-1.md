# PushCore review round 1

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

- The commit range d4e2728..3e59431 changes no file under `client/godot/core/push_core/`. On the client it changes AuthCore tests only (three removed `check_logs` asserts in `client/godot/core/auth_core/tests/`), ScreenEffectCore, TweenCore (`TweenCore.get_finite_playing_count`), UICore (`UICore.is_flow_in_progress`), UnitTestCore (`PUT /started` before the first test, setting `UnitTestCore.startTimeLimitMs`) and the generated core settings (`QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs`, `uiQuality.settleLimitMs`)
- PushCore calls only `AuthCore.get_consent`, `AuthCore.update_push_consent`, `AuthCore.is_initialized`, `AuthCore.is_logged_in` and subscribes to `AuthCore.LoginCompletedEvent` and `AuthCore.SessionEndedEvent` (`client/godot/core/push_core/push_core.gd:276`, `:354`, `:411`, `:421`). The range does not change `client/godot/core/auth_core/auth_core.gd`. PushCore does not call TweenCore, UICore, ScreenEffectCore or QACore, and does not read any of the changed settings keys
- The PushCore test support inits TweenCore and UICore (`client/godot/core/push_core/tests/support/push_test_env.gd:56`, `:57`); the range only adds functions to them. The PushCore tests use UnitTestCore (`set_test_settings`, `advance_clock`, `wait_frames`, `check_logs`), which the range does not change; it changes only the run start (`_begin_run`, `_send_started`, `_send_init_failure`). `ogw core test godot PushCore` ran on this checkout at 3e59431 and passed
- The server `auth` module changes of the range (`server/core/auth/login.ts`, `server/core/auth/deletion.ts`, `server/core/auth/dev/index.ts`) are server code, not the client PushCore target, and contain no push or push consent change; they were not reviewed here
- The rest of PushCore was not reviewed aspect by aspect, because the range does not reach it
- The FCM and APNs real adapters and their plugins were not run on a device. Only the core test run above, on the host, covers them
