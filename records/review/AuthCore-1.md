# AuthCore review round 1

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

- Commit range 85f6b36d..9808fd47 touches AuthCore only in 6f6ee9cd (`client/godot/core/auth_core/auth_core.gd`, `client/godot/core/auth_core/tests/test_account.gd`, `core-spec/AuthCore.json`) and in the generated `LogoutOtherDevicesRequest`/`LogoutOtherDevicesResponse` of `client/godot/generated/contract/core_contract.gd`. The other commits change server modules and other client modules, and were read only to confirm that they do not reach AuthCore code
- Tests run: `ogw core test godot AuthCore --file client/godot/core/auth_core/tests/test_account.gd`, which passed. The other AuthCore test files, the `--web` run and the tests of modules that depend on AuthCore were not run
- `link_account` creates the pending token after a failed write only while `_session` is still the session that got the `LinkAccount` response and the life has not changed (`client/godot/core/auth_core/auth_core.gd:1495`, `client/godot/core/auth_core/auth_core.gd:1498`). If `SESSION_REPLACED` or `release` happens while that write is running, no pending token is kept, so the storage item keeps the old `linked_providers`. `auth-core.md` line 203 does not say what should happen when the session ends during the write. This is not a finding because confidence is below 80. The guard is needed for `logout` and `withdraw`, which delete the pending token, so it should stay for those
- The changed condition `not _pending_token.is_empty()` (`client/godot/core/auth_core/auth_core.gd:1490`, previously `_pending_token == token`) behaves differently only when a pending token is different from the session login token while a session exists. No path that sets a pending token was found that makes the two different (auto login and `link_account` both set it to the session token), so no test can observe the difference
- Server `auth` `LogoutOtherDevices` behavior was not reviewed. It belongs to a different target
