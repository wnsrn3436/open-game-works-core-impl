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

- The commit range 2ef5ae8..45dd815 changes no file under `client/godot/core/push_core/`. On the client it changes AuthCore (public code: `AuthCore.get_public_code`, `LoginResult.public_code`, `AuthSession.public_code`), BootstrapCore, SoundCore (pitch and volume variation, voice duck), TweenCore, the generated contract (`AuthResult.public_code`, `BanDetail.public_code`, `PublicProfileEntry.public_code`, `FindUserByPublicCode`) and the generated core settings (`SoundCore.*` variation and duck keys, `uiQuality`, `public-profile.findPerMinute`)
- PushCore calls only `AuthCore.get_consent`, `AuthCore.update_push_consent`, `AuthCore.is_logged_in` and subscribes to `AuthCore.LoginCompletedEvent` and `AuthCore.SessionEndedEvent` (`client/godot/core/push_core/push_core.gd`). The range does not change any of them; it only adds the field `public_code` that `_open_session` and `_login_failure` fill (`client/godot/core/auth_core/auth_core.gd:721`, `:759`). PushCore does not read `public_code`. The range does not change the `RegisterPushTokenRequest` and `UpdatePushConsentRequest` messages PushCore sends
- The PushCore test support inits SoundCore and TweenCore (`client/godot/core/push_core/tests/support/push_test_env.gd:55`, `:56`). `SoundCore.init` now fails when the five new SoundCore settings are missing (`client/godot/core/sound_core/sound_core.gd:481`); the range adds them to `client/godot/generated/core_settings.json`. `ogw core test godot PushCore` ran on this checkout at 45dd815 and passed
- The server `push` module tests changed in the range (`server/core/push/tests/*`). They are tests of the server module, not of the client PushCore target, and were not reviewed here
- The rest of PushCore was not reviewed aspect by aspect, because the range does not reach it
- The FCM and APNs real adapters and their plugins were not run on a device. Only the core test run above, on the host, covers them
