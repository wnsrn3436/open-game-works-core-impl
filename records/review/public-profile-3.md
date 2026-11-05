# review public-profile round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/public-profile/tests/profiles.test.ts:111 | The `## test` items that the spec change added have no test. (1) With `public-profile.maxRequestCount` 2, `get_public_profiles` of 5 users calls `storage.get_user_records` 3 times and `storage.get_user_record` never (open-game-works-core/skills/server-core/modules/public-profile.md:141). (2) The user ID list B, A, B gives one entry of A, then one of B, and one `build_public_profile` call per user (public-profile.md:142). (3) `FindUserByPublicCode` of an existing user calls `get_user_records` once and `get_user_record` never (public-profile.md:143). No test under server/core/public-profile/tests/ wraps `storage.get_user_records` or `storage.get_user_record`; the only `get_user_record` use is a helper reading a public code (requests.test.ts:233). No test passes a duplicated user ID to `get_public_profiles`; the duplicate tests are the `INVALID_REQUEST` ones of `GetPublicProfiles` (profiles.test.ts:199, requests.test.ts:110). The test at :111 counts only `nickname.get_nicknames` calls. So the current code, which breaks (1) and (3) (see R2-1), passes the whole suite: `profiles.test.ts` 18/18 passed in a temporary copy (sqlite). | Add tests that wrap `storage.get_user_records` and `storage.get_user_record` and assert the call counts for the 5-user case and the `FindUserByPublicCode` case, and a test of `get_public_profiles(ctx, [B, A, B])` that asserts the entries A, B and 2 hook calls. | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | server/core/public-profile/index.ts:209-214 did not change in this range. It still calls `storage.get_user_record` once per distinct input user ID, and `get_user_records` is in neither `PublicProfileStorage` (:17) nor the `required_module` method list (:166). The spec change removed the blocker: `storage` now has `get_user_records` (server/core/storage/rows.ts:103, one `SELECT ... WHERE user_id IN ...` query), and public-profile now requires one `get_user_records` call per group of `public-profile.maxRequestCount` distinct IDs (public-profile.md:56, :57, :62). The finding is therefore now also a difference from the spec. Measured in a temporary copy (sqlite, `public-profile.maxRequestCount` 2) by wrapping both storage operations: 5 users gave 5 `get_user_record` calls and 0 `get_user_records` calls, where public-profile.md:141 expects 3 and 0. `FindUserByPublicCode` of an existing user (:292 goes through `get_public_profiles`) gave 1 `get_user_record` and 0 `get_user_records`, where public-profile.md:143 expects 0 and 1. The query count still grows with the list the caller passes (e.g. server/core/chat/index.ts:398). Fix: per group, call `storage.get_user_records(db, chunk)` once, keep elements whose `record.withdrawn_at` is `null` and take `record.public_code`; add `get_user_records` to `PublicProfileStorage` and to the `required_module` list. |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D4 | open | R2-1 | server/core/public-profile/index.ts:210 still runs one `get_user_record` query per input user ID (5 calls and 0 `get_user_records` calls measured for 5 users with `public-profile.maxRequestCount` 2). The spec and `storage` now provide the bounded batch read, so the item now differs from the spec. It stays carried by R2-1, which is `open` in `## previous`. |

## must fix

none

## unknown

- No file under `server/core/public-profile/` changed in the commit range. Of the changed files, only `server/core/storage/rows.ts` and `server/core/storage/index.ts` (the new `get_user_records`) touch what this target calls. `get_user_records` belongs to the `storage` target and was read only as far as public-profile uses it. The other changed files (other modules' code, tests and records) were not reviewed.
- The B, A, B case (public-profile.md:142) was measured to pass: 2 entries, A then B, and 2 hook calls. `FindUserByPublicCode` of a withdrawn user's code being `USER_NOT_FOUND` is covered by server/core/public-profile/tests/requests.test.ts:244. Neither one was found to be a defect.
- The measurements and the run of `profiles.test.ts` used only `OGW_DEFAULT_DB=sqlite` with the server build data of `open-game-works-core-impl/server/build/data`, in a temporary copy of the checkout. PostgreSQL runs and runs of `requests.test.ts` and `last-active.test.ts` were not done.
- The spec changes to `core`, the `core` command, `server-core` (log `request` field, truncated IP) and `logging` were read. None of their changed lines sets a behavior that public-profile code relies on: public-profile writes only `error` logs with `logging.write`, without an IP or a `request` value. So public-profile code was not checked further against them.
