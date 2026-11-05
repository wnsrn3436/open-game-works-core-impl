# review public-profile round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/public-profile/index.ts:210 | Debt D4 and R2-1, still open. The changed spec now sets profile build to call `storage.get_user_records`(`storage.db`(ctx), the user IDs of one group) once per group of `public-profile.maxRequestCount` distinct user IDs (open-game-works-core/skills/server-core/modules/public-profile.md:56, :57, :62), and `storage` now has `get_user_records` (server/core/storage/rows.ts:102, one `SELECT ... FROM "user" WHERE user_id IN ...` query). `get_public_profiles` still calls `storage.get_user_record` once per distinct input user ID inside the `filter` at :209-214, and `get_user_records` is not in `PublicProfileStorage` (:17) or the `required_module` list (:166). No public-profile code changed in this range. Measured in a temporary copy (sqlite) with `public-profile.maxRequestCount` 2 and 5 users: `get_public_profiles` made 5 `get_user_record` calls and 0 `get_user_records` calls, where `## test` (public-profile.md:141) expects 3 `get_user_records` calls and no `get_user_record` call. `FindUserByPublicCode` (:292) goes through the same path, so it calls `get_user_record` and not `get_user_records` (public-profile.md:143). The query count still grows with the list the caller passes (e.g. server/core/chat/index.ts:398). | In `get_public_profiles`, for each group of `max_request_count` distinct ascending IDs, call `storage.get_user_records(db, chunk)` once, keep the elements whose `record.withdrawn_at` is `null` and take `public_code` from `record.public_code`; then build the hook output for those users. Add `get_user_records` to `PublicProfileStorage` and the `required_module` method list. | no | 95 |
| R3-2 | spec | medium | server/core/public-profile/tests/profiles.test.ts:111 | The `## test` items added by the spec change have no test: `get_public_profiles` of 5 users with `public-profile.maxRequestCount` 2 calls `storage.get_user_records` 3 times and `storage.get_user_record` never (public-profile.md:141); the user ID list B, A, B gives one entry of A then one of B and one `build_public_profile` call per user (public-profile.md:142); `FindUserByPublicCode` of an existing user calls `get_user_records` once and `get_user_record` never (public-profile.md:143). No test under server/core/public-profile/tests/ wraps `get_user_records` or `get_user_record`, and no test passes a duplicated user ID to `get_public_profiles` (the only duplicate-ID tests are the `INVALID_REQUEST` ones of `GetPublicProfiles`, profiles.test.ts:199, requests.test.ts:110). The test at :111 counts only `nickname.get_nicknames` calls. | Add tests that wrap `storage.get_user_records` and `storage.get_user_record` and assert the call counts for the 5-user and `FindUserByPublicCode` cases, and a test of `get_public_profiles(ctx, [B, A, B])` asserting the entry order A, B and the hook call count 2. | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | Became R3-1: server/core/public-profile/index.ts:209-214 unchanged in this range and still calls `storage.get_user_record` once per user ID (measured 5 calls for 5 users), although `storage.get_user_records` now exists and the spec sets it. |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D4 | open | R1-4 | server/core/public-profile/index.ts:210 still runs one `get_user_record` query per input user ID; measured 5 calls and 0 `get_user_records` calls for 5 users with `public-profile.maxRequestCount` 2. The spec change removed the blocker (storage `get_user_records`, public-profile.md:57, :62), so it is now a difference from the spec. The finding is R3-1. |

## must fix

none

## unknown

- Of the commit range, only `server/core/storage/rows.ts` and `server/core/storage/index.ts` (the new `get_user_records`) touch what this target calls; no file under `server/core/public-profile/` changed. The other changed files (other modules' code, tests and records) were not reviewed. `get_user_records` itself belongs to the `storage` target and was read only as far as public-profile uses it.
- The measurements and the run of `profiles.test.ts` and `last-active.test.ts` (27 passed) used only `OGW_DEFAULT_DB=sqlite` with the server build data of `open-game-works-core-impl/server/build/data`, in a temporary copy of the checkout. PostgreSQL runs were not done. `requests.test.ts` was not run.
- The spec changes to `logging`, `core`, `core` command and `server-core` were read; none of their changed lines sets a behavior that public-profile code relies on (public-profile writes only `error` logs with `logging.write`), so no public-profile code was checked against them further.
