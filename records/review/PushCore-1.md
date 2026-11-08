# review PushCore round 1

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

- Scope: the commit range `85f6b36d..054d2fe6` changes no file under `client/godot/core/push_core/` and no PushCore spec, so I checked only the changed code that PushCore or its core tests call. In the client, the range changes `AuthCore`, `LogCore` and `TimeCore` among the PushCore dependencies, plus the generated `CoreContract` (`LogoutOtherDevices` messages, matchmaker fields) and core settings. None of the changed core settings keys is a `PushCore.*` key, and `RegisterPushTokenRequest` is unchanged
- `AuthCore` (`client/godot/core/auth_core/auth_core.gd`): `link_account` now keeps the pending token rules after a failed storage write, and `logout_other_devices` was added. Neither publishes `LoginCompletedEvent` or `SessionEndedEvent` and neither changes `get_consent` or `update_push_consent`, so the PushCore token registration, the `cancel_all_local` on session end and `get_push_consent`/`set_push_consent` act as before. A device whose login token another device's `LogoutOtherDevices` deleted ends with `Rejected` (auth-core.md:207). PushCore does not cancel local pushes on `Rejected` (push-core.md `### local push`), which is correct because the account is the same, and its next `LoginCompletedEvent` registers the token again. Server `push` stops sends to that device through `session.check_current` (server-core/modules/push.md:72)
- `TimeCore` (`client/godot/core/time_core/time_core.gd`): the DEV frame step changes the real frame increase only when `_frame_step_fps` > 0. PushCore reads `TimeCore.get_real_time` for the device token time limit (`push_core.gd` `_register_token`, `_on_frame`), and the native adapters read it for the token and permission read time limits (`adapters/native_push_adapter.gd:46`, `adapters/native_notification_adapter.gd:83`). At a frame step these measure frame-stepped real elapsed time, which is how time-core.md sets real elapsed time. The fake notification adapter and `PushCoreDev.list_scheduled_local` use device time (`dev/adapters/fake_notification_adapter.gd:46`, `dev/push_core_dev.gd:46`), and the frame step does not change device time. `make_random_seed` is not used by PushCore. The new frame step and random seed state is cleared in `TimeCore._reset`, so the PushCore tests that release and init TimeCore (`tests/support/push_test_env.gd`) see no frame step
- The TimeCore frame step problems this range reveals (`init` turns on the frame step from `--fixed-fps` or the Movie Maker fps without `set_frame_step`, and the DEV operation is named `set_test_frame_step` instead of `set_frame_step`) are already items D1 to D3 of `records/review-debt/TimeCore.json`, so they are not written in `## out of scope`
- `LogCore` (`client/godot/core/log_core/log_core.gd`): the range changes only comments. No code that PushCore calls changed
- Tests run: `ogw core test godot PushCore` on this checkout: pass. Not run: the browser run (`--web`), and no run with the engine started at a fixed frame rate (`--fixed-fps` or Movie Maker), so the device token time limit at a frame step was checked only by reading the code
- Not checked: the PushCore code that the range did not change was not audited as a whole, because the commit range is not `none`
