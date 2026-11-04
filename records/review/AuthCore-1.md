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

- Scope of this round: the commit range changes no file under client/godot/core/auth_core/, no `core-spec/` file, no `proto/` file and no client module that AuthCore depends on. Outside `records/`, it changes client/godot/core/realtime_core/, server/core/auth/deps.ts, server/core/auth/tests/withdraw.test.ts, server/core/block-report/, server/core/iap/, server/core/routing/tests/settings-minimum.test.ts and settings/core-settings.schema.json. The rest of AuthCore was not reviewed, because it is outside the range
- Read for the server change (`block-report.remove_user` can be `FAILED`, so `Withdraw` and `ConfirmAge` under the minimum age can end with `INTERNAL`): `withdraw`, `_forget_account`, `prepare_consent`, `_send` and `auth_request_call.gd`, against the failure flow of network-core.md. `withdraw` keeps the session and the storage item and returns `false`, and `prepare_consent` returns `Failed`. No client code branches on `INTERNAL`
- `INTERNAL` was not run on the client. `test_withdraw_failure_changes_nothing` (client/godot/core/auth_core/tests/test_account.gd:69) answers `Withdraw` with `INVALID_REQUEST`, and the client tests use a scripted response, so no client test ran against a server whose `block-report.remove_user` was `FAILED`. The equal handling of the two codes is from reading the code
- Read for the RealtimeCore change: the calls of `AuthCore.get_access_token`, `refresh_access_token` and `get_user_id` in client/godot/core/realtime_core/realtime_core.gd, and `_provide_access_token`, `_refresh_token` and `_run_refresh`. The only new path to AuthCore is `_is_host` from `_on_foreground_returned` (client/godot/core/realtime_core/realtime_core.gd:1210), which reaches `get_user_id`. Without a session it gives `0` and an error log, as auth-core.md sets. I did not check whether a room can remain in RealtimeCore after the session ended, which is what would produce that log. That belongs to the review of RealtimeCore
- Read for the settings change: the range changes no `AuthCore.*` schema key. `AuthCore.webLinkPromptLogins` has schema `minimum` 0, and `_web_link_prompt` (client/godot/core/auth_core/auth_core.gd:530) does not take the modulo at 0 and opens no popup. `auth-core.md` does not set the behavior of that value. `AuthCore.desktopSignInTimeoutMs` at its minimum 0 and the `AuthCore.tokenRefreshMarginMs` paths at 0 were not run
- Tests run: only client/godot/core/auth_core/tests/test_account.gd, with `ogw core test godot AuthCore --file` (pass). The other AuthCore test files, the browser run (`--web`) and the RealtimeCore tests were not run. No defect was restored, because this round has no finding that needs it
- D6 of records/review-debt/AuthCore.json (Windows `backend::available()`) is outside the scope of this review, because input `## debt` is `none`, and it was not checked again. The range does not touch client/godot/plugins/ogw-secure-storage/
- Of the defining documents, I read auth-core.md in full, and server-core/modules/auth.md, network-core.md, core/command.md and engines/godot.md only in the parts about withdrawal, the failure flow, review lists, core tests and the rows of AuthCore. core/SKILL.md, client-core/SKILL.md and the specs of log-core, event-core, time-core, local-data-core, localization-core, ui-core, message-core and user-state-core were not read, because the range changes none of those modules
