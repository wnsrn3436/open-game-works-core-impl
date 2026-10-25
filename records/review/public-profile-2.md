# review: public-profile round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | The new test `count_find_attempt > is INTERNAL with one error log and counts nothing when the user transaction is FAILED` (server/core/public-profile/tests/profiles.test.ts:259-277) holds the user lock with `hold_user_lock` under `storage.userLockWaitMs` 200. It checks for `CORE_ERROR_INTERNAL`, a `public_profile_find_counter` row that does not change, and exactly one `error` log with that user ID. `storage` writes no log of its own on `FAILED` (server/core/storage/tx.ts:85, 100), so the log check depends on public-profile. The defect was restored in a temporary detached worktree of b0fdca6 outside this checkout (since removed), and only this file was run with `ogw core test server public-profile --file server/core/public-profile/tests/profiles.test.ts`. (1) With the `FAILED` branch at server/core/public-profile/index.ts:272-275 changed to `return 'pass'`, the new test failed on SQLite and PostgreSQL (`expected 'pass' to be 8`). (2) With only the `write_error` at index.ts:273 removed, it failed on both DBs (`expected [] to deeply equal [ ObjectContaining{…} ]`). With unchanged code, the same run passed on both DBs |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `server/core/public-profile/tests/profiles.test.ts` was run. The other public-profile test files and the dependent modules were not run in this review
- The other code change in this range, server/core/admin-api/tests/auth.test.ts:26 (adds `find_user_by_public_code` with role `read` to the collected `auth` operations), is in `admin-api`, not public-profile. It was checked only against the `auth` spec (role `read`) and server/core/auth/admin.ts:54-78, and was not run
