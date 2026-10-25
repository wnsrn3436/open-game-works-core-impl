# review RemoteConfigCore round 1

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

- The commit range d4e2728..adeee2d changes no RemoteConfigCore file: `git diff --stat` shows no change under `client/godot/core/remote_config_core/`, and `core-spec/RemoteConfigCore.json` is unchanged. Input `## spec changes` is `none`. So I reviewed only whether the changes in the range reach RemoteConfigCore code or tests
- Dependencies (`LogCore`, `EventCore`, `TimeCore`, `DataCore`, `NetworkCore`, `AuthCore`): the only change in the range is AuthCore tests, where three lines `assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)` are removed (before the range at `client/godot/core/auth_core/tests/test_account.gd:188`, `test_login.gd:470`, `test_terms.gd:88`). `auth_core.gd` is unchanged, so `is_initialized`, `is_logged_in`, `get_login_remote_config` and `LoginCompletedEvent`, which RemoteConfigCore uses, are unchanged. The contract (`proto/`, `client/godot/generated/contract/`) is unchanged
- Server `remote-config`: the range does not change it. `server/core/auth/login.ts` changes only the failure path of user creation, key claim and transaction failure (`transaction_failed` in place of `CORE_ERROR_INTERNAL`). The success path that fills `AuthResult.remote_config` (`server/core/auth/login.ts:244`) is unchanged, so the login apply input of RemoteConfigCore is the same
- Modules the RemoteConfigCore tests start (`client/godot/core/remote_config_core/tests/support/remote_config_test_case.gd:62`, `:63`, `:71`): TweenCore gains `get_finite_playing_count` (`client/godot/core/tween_core/tween_core.gd:328`) and UICore gains `is_flow_in_progress` (`client/godot/core/ui_core/ui_core.gd:654`). Both are additions only; `init`, `prepare` and the existing paths are unchanged. The generated core settings add `QACore.captureJpgQuality` and `UnitTestCore.startTimeLimitMs` and rename `uiQuality.settleMs` to `settleLimitMs`; RemoteConfigCore reads none of them (it reads `RemoteConfigCore.refreshIntervalMs`)
- UnitTestCore: the range adds the run start signal `PUT /started` in `_begin_run` and `_send_init_failure` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:228`, `:296`). It runs once per run before the first test and does not change `add_pending`, `release_pending`, `add_result`, `check_logs`, `advance_clock`, `latch_event`, `wait_latch` or `wait_frames`, which the RemoteConfigCore tests use. I checked this by reading the code; I did not run the RemoteConfigCore tests, since they run through `ogw core test` and its test host, which a review agent does not start
- I did not review the rest of RemoteConfigCore because the range did not touch it, and I did not review the new AuthCore, ScreenEffectCore, TweenCore, UICore, UnitTestCore and server auth code and tests; they belong to the reviews of those modules
