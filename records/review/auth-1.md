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

- Scope: the commit range 85f6b36d..910daf01 changes `server/core/auth/` only in e3f3d9e0 (login token expiry, `LogoutOtherDevices`, `revoke_login_tokens`, and the auth names in `server/core/routing/spec_tables.ts`). In the dependencies of auth, the range changes `storage` (DB metrics, seed provider, `watch_db_wait`) and `logging` (metrics), and `routing` (server process with worker threads). Those were read only for the paths that auth calls (`storage.read_db`, `run_request_transaction`, `session.check_current`, the step 15 handler result of `routing` in server/core/routing/pipeline.ts:706-713 and its step 17 failure path); `session`, `server-time`, `admin-api` and `mailbox` have no change in the range
- Checked against auth.md `### token`, `### LinkAccount, Logout, LogoutOtherDevices, Withdraw`, `### login token revocation`, `## error`, `## settings` and `## test`, session.md (`check_current` reads with `storage.read_db`, `end_session` on `revoke_login_tokens`), admin-api.md (role `ops` of `revoke_login_tokens`, `user_target`) and storage.md (per-user lock of user transactions, `read_db` reads only committed rows): `login_token_expired` (server/core/auth/login.ts:326-329) judges the first `read_db` row with `<=` against `server-time.user_now` and reads the link with the same handle; the expired path returns `UNAUTHORIZED` without a `security` log in `AutoLogin` and `RefreshToken`; `logout_other_devices` (server/core/auth/account.ts:60-66) calls `check_current` inside the request transaction, after the per-user lock, so an `AutoLogin` of another device that committed before it is seen and one that has not committed waits for that lock; `revoke_login_tokens` (server/core/auth/admin.ts:39-46) is `conflict` before any write; the deletes use the `(user_id, session_id)` index of `auth_login_token` (server/core/auth/tables.ts:27-30)
- Tests run: `ogw core test server auth --file server/core/auth/tests/logout-other-devices.test.ts` and `--file server/core/auth/tests/login-token-expiry.test.ts`, both pass. The rest of the auth suite and the suites of other modules were not run. The tests ran on SQLite; the PostgreSQL path of `LogoutOtherDevices` (user row `SELECT ... FOR UPDATE` before `check_current` on the separate `read_db` connection) was checked by reading storage.md:307 and was not run
- Defect restoration (step 5) is not done in round 1. Whether each new test fails on a restored defect was judged by reading: removing the `check_current` of `LogoutOtherDevices`, the `auth_social_link` check of `revoke_login_tokens` or of expiry, the `end_session` call, or the renewal by `RefreshToken`, or using `<` in place of `<=`, each breaks an assert of the new tests; this was not run
- Not checked: client `AuthCore` (another review target), and expiry under a per-user cheat time offset (no `## test` item of auth.md relies on it)
