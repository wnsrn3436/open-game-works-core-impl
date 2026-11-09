# review auth round 1

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

- Scope read: in the commit range the only change under `server/core/auth/` is the new test of `server/core/auth/tests/token.test.ts:95` (Logout of S1 past routing step 5 keeps S2 and the login token rows of an AutoLogin that committed before its transaction). The changes the auth code calls were read against the defining documents: `session.end_session` (`server/core/session/index.ts:137`, now deleting only the ctx session in a request with a session and any session in an out-of-request change), which `logout` (`server/core/auth/account.ts:44`) and `revoke_login_tokens` (`server/core/auth/admin.ts:39`) call, and `storage.fail_transaction` with the `not_failed` guard of `server/core/storage/core.ts:268`, which no non-test auth code calls. `Logout` (login token rows of the ctx session and the rows their `previous_hash` points to, then `end_session`) matches `### LinkAccount, Logout, LogoutOtherDevices, Withdraw` of the auth spec and `### session` of the session spec in the races checked by hand: an AutoLogin with the same login token, with the unused next token, or with another device's login token committing S2 before the Logout transaction leaves every S2 row and the S2 session record
- Test evidence of the new test checked by reading only: it would fail if `end_session` deleted the user's session record whatever its session ID (`probe(next)` would be `UNAUTHORIZED`) and if `logout` selected login token rows by user (the row list would change). No defect was restored in a worktree, since round 1 does not need it
- Changes in the range outside the server auth module were not reviewed as auth findings: client `AuthCore`/`BootstrapCore` (`client/godot/core/auth_core/`, `client/godot/core/bootstrap_core/`), `iap`, `item-ledger`, `admin-api` item history, `logging` metrics, `idempotency`, `nickname`, GameUpdateCore. Those are other module targets
- Tests: `ogw core test server auth session` passed on SQLite. On PostgreSQL 7 tests failed with connect timeouts, `fetch failed`, `wait_background did not end within 10000 ms` and 60000 ms test timeouts, while other reviews ran on the host: `consent.test.ts` (2 tests), `login-token-expiry.test.ts`, `social.test.ts`, `token.test.ts`, `withdraw.test.ts` of auth and `log.test.ts` of session. On rerun one file at a time, all six files passed on both databases, so the failures were not reproduced and are not counted as findings. Their cause (host load on the shared PostgreSQL) is assumed and was not checked
- The whole core test suite and the tests of the modules that depend on auth were not run: `ogw review run` runs them after each fix
