# review auth round 1

## findings

none

## previous

none

## out of scope

- server/core/auth/social.ts:41: medium `auth.socialVerifyTimeoutMs` has schema `minimum` 0 (settings/core-settings.schema.json:186), and `timed` passes the value to `server-time.network_time_limit`, which throws `RangeError` when ms is below 1 (server/core/server-time/network_time_limit.ts:9). With value 0, a social `Login`, `LinkAccount` and the `google` method of `POST /account/deletion` reach a throw instead of the rejection, time limit exceeded or communication failure that the spec sets. The server still starts with this value, so server/core/routing/tests/settings-minimum.test.ts does not catch it. It existed before the range, and the range raised only period keys to 1. The spec side is D7 of records/review-debt/spec-auth.json

## debt

none

## must fix

none

## unknown

- Scope of this round: the commit range changes only server/core/auth/deps.ts and server/core/auth/tests/withdraw.test.ts in the auth folder. Beyond those, I read the callers of `withdraw` (account.ts, admin.ts, deletion.ts, guest_sweep.ts), `block-report.remove_user` and `add_report`, the `lock_game_row` and `hold_game_row_lock` implementations, and the auth keys of the schema change. The rest of the auth module was not reviewed, because it is outside the range
- Tests run: only server/core/auth/tests/withdraw.test.ts, with `ogw core test server auth --file` (pass) on SQLite and PostgreSQL. The other auth test files and the block-report tests were not run. server/core/routing/tests/settings-minimum.test.ts was read and not run
- Defects restored in a temporary copy, run on PostgreSQL unless noted. Removing the `lock_game_row` call from `block-report.remove_user` fails the new block-report test at the `Withdraw` assert. Making the guest sweep skip `block-report.remove_user` and `guild.remove_user` fails both lock tests at the `withdrawn_at` assert
- SQLite cannot tell whether `remove_user` took the lock: with that `lock_game_row` call removed, the new block-report test still passes on SQLite, because `hold_game_row_lock` there holds `BEGIN IMMEDIATE` and blocks every write transaction, as the `testing` spec sets. The evidence for that lock comes only from the PostgreSQL run
- The rollback asserts of the shared lock test read `user_state`, `auth_social_link`, `withdrawn_at` and `revoke` calls, for the withdrawing user only (`withdrawn_at` also for the guest). Rollback of rows that earlier `remove_user` steps changed was not run with such rows present. I checked by reading only that `ranking` clears its cache in `after_commit`, and did not read the bodies of the other `remove_user` functions in full
- Concurrent `add_report` and withdrawal on two server instances: the tests in server/core/block-report/tests/withdraw.test.ts were read and not run
- The subscription changes of server/core/iap/grant.ts were read only for their effect on `iap.has_granted_payment`, which the guest cleanup calls. server/core/iap/adapters/google.ts was not read
