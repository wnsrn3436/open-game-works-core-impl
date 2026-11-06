# review AuthCore round 1

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

- The commit range de482eec..9069447b changes no file of `client/godot/core/auth_core/` and no AuthCore spec (`## spec changes` is `none`). The changes are in CameraCore, PoolCore, QACore, ScreenEffectCore, SoundCore, TweenCore, the QACore core settings keys (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings*.json`, `server/core/testing/dev/setting_types.ts`) and records. AuthCore code references none of the changed modules (no reference to TweenCore, SoundCore, PoolCore, CameraCore, ScreenEffectCore or QACore in `client/godot/core/auth_core/*.gd`, `adapters/`, `dev/`, `events/`). The AuthCore tests only init and release PoolCore, SoundCore and TweenCore (`client/godot/core/auth_core/tests/support/auth_test_env.gd:79`, `client/godot/core/auth_core/tests/test_plugin_waits.gd:266`), and the new DEV state of those modules defaults to off and is reset in their reset paths. The changed QACore code that touches AuthCore (`client/godot/core/qa_core/dev/qa_builtins.gd` `expire_access_token`) is unchanged in behavior: only new commands were added before it. So the AuthCore code outside the range was not reviewed, as the commit range limits this round to the problems the changes cause or reveal
- `ogw core test godot AuthCore` was run on this checkout and passed (headless pass and render pass). The browser run (`--web`) of AuthCore was not run
