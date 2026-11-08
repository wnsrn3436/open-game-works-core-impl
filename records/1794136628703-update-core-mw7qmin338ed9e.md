# update core AuthCore

## done

- Module `AuthCore` (Godot, `client/godot/core/auth_core/auth_core.gd`), commit `6f6ee9cd`
  - `logout_other_devices`: new operation. Without init or without a session it is `false` without a request and leaves an error log. Otherwise it sends `LogoutOtherDevices` once with `NetworkCore.send` (failure callback returns `true`) and returns `true` on success, `false` on failure. Session, pending token and storage item are not touched
  - `link_account`: on success the linked provider list kept with the pending token is replaced whenever there is a pending token. When the storage item write fails, it logs an error and, when there is no pending token and the session is still the same, keeps the session login token as the pending token, with the same token as the login token kept with it and the new linked provider list. From then on the existing pending token rules write the item again (`AppBackgroundEnteredEvent`, `AppForegroundReturnedEvent`, `AppQuitEvent`, `release`, refresh success) until a write succeeds. Refresh keeps sending the session login token, because the kept token is that same token
  - Expired or revoked login tokens: no code change was needed. Auto login `UNAUTHORIZED` was already `Rejected` and opened account recovery with the provider from the storage item, or `[auth_recover_guest]` when there is none. The new tests cover it
- Tests (`client/godot/core/auth_core/tests/test_account.gd`):
  - `test_logout_other_devices_keeps_session_and_storage_item`
  - `test_logout_other_devices_keeps_the_pending_token`
  - `test_logout_other_devices_without_session_fails_without_request`
  - `test_guest_whose_login_token_was_deleted_gets_guest_recovery`
  - `test_link_account_write_failure_keeps_session_token_pending_until_a_write_succeeds`: covers the new `## test` item. It also checks refresh with the session token, the write on the background event with the response providers, and recovery with the Google button after `UNAUTHORIZED`
- No other module's code changed. No engine-specific implementation rules document written; `## <engine> build` of `tools/ogw.md` not written
- Last runs, on the committed HEAD:
  - `ogw core test godot AuthCore AdCore BootstrapCore PaymentCore PushCore QACore RealtimeCore RemoteConfigCore TutorialCore UnitTestCore`: all pass except RealtimeCore. RealtimeCore failed in that combined run with `Not enough response headers` / `Invalid response headers` from its headless pass. The run that followed, `ogw core test godot RealtimeCore`, passed, so the last godot run of each module is a pass
  - The same module list with `--web`: all pass
  - `ogw code check core`: type check, lint, dependency and secret all pass

## spec proposals

none

## review

none

## unverified

- `RealtimeCore` godot fail in the combined run: cause not reproduced. It passed when run alone, and AuthCore code does not reach its HTTP response handling. My guess is load from the parallel run, but this is not checked
- No server core module in this worktree implements `LogoutOtherDevices` (`server/core` has no handler; only the generated contract has it). The client was tested against the fake network of the AuthCore tests only, not end to end against server `auth`
