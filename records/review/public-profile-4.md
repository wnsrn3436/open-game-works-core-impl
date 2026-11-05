# review public-profile round 4

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R4-1 | test evidence | medium | server/core/public-profile/tests/profiles.test.ts:170 | The B, A, B test (public-profile.md:142 `## test`) runs with the default `public-profile.maxRequestCount` (100), so B, A, B falls into one group, and `storage.get_user_records` itself returns a repeated user ID once (server/core/storage/rows.ts:106 `ascending_ids`). The test therefore does not fail when the dedupe of server/core/public-profile/index.ts:213 is removed. Restored in a temporary copy by changing `chunks([...new Set(user_ids)].sort(compare), max_request_count)` to `chunks([...user_ids].sort(compare), max_request_count)`: all 41 tests of server/core/public-profile/tests/ passed (sqlite). Yet that code breaks "one entry per distinct user ID" (public-profile.md:38) when a repeated ID crosses a group boundary: with `public-profile.maxRequestCount` 2, `get_public_profiles(ctx, [B, A, B])` gave the entries A, B, B and 3 `build_public_profile` calls (A, B, B), where the current code gives A, B and 2 calls. | Run the B, A, B test (or one more case of it) with `public-profile.maxRequestCount` 2, so that the sorted list A, B, B splits as [A, B], [B] and the test asserts the entries A, B and one hook call per user. | no | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | server/core/public-profile/index.ts:213-219 now splits the distinct sorted input IDs into groups of `public-profile.maxRequestCount` and calls `storage.get_user_records(db, chunk)` once per group, keeping elements whose `record.withdrawn_at` is `null` and taking `record.public_code`. `get_user_records` is in `PublicProfileStorage` (:17) and the `required_module` list (:166). `storage.get_user_record` is used only by `is_active_user` (:181). Measured by the new tests in a temporary copy (sqlite): 5 users with `public-profile.maxRequestCount` 2 give `get_user_records` groups [u0,u1], [u2,u3], [u4] and 0 `get_user_record` calls; `FindUserByPublicCode` of an existing user gives one `get_user_records` call with [user] and 0 `get_user_record` calls. The output order stays ascending: groups are taken in ascending order and `get_user_records` returns `ORDER BY user_id` (server/core/storage/rows.ts:111). |
| R3-1 | fixed | Tests added at server/core/public-profile/tests/profiles.test.ts:156 (5 users, call counts), :170 (B, A, B) and :185 (`FindUserByPublicCode` call counts). With server/core/public-profile/index.ts restored to its f7b9f20 version (one `get_user_record` per input ID) in a temporary copy, the tests at :156 and :185 failed (2 failed, 39 passed); with the current code all 41 pass. The B, A, B test at :170 passes on both, because the old code was already right for that item; its weaker check is written as R4-1. |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D4 | fixed | none | server/core/public-profile/index.ts:214 reads the `user` rows with one `storage.get_user_records` query per group of at most `public-profile.maxRequestCount` IDs, instead of one `get_user_record` query per input ID, as public-profile.md:56-62 now sets. Measured: 5 users with `public-profile.maxRequestCount` 2 give 3 `get_user_records` calls and 0 `get_user_record` calls. The per-group `read_activity` (:222) and `nickname.get_nicknames` (:220) calls were already bounded the same way. |

## must fix

none

## unknown

- Only `server/core/public-profile/index.ts` and `server/core/public-profile/tests/profiles.test.ts` of this target changed in the commit range. The other changed files (other modules' code, tests and records) were not reviewed. `storage.get_user_records` belongs to the `storage` target and was read only as far as public-profile relies on it (dedupe and ascending order).
- `nickname.get_nicknames` now gets the whole group of distinct input IDs, also missing and withdrawn users (the spec says the group). Their nicknames are not used because only kept users are in the output; this was read, not measured.
- Test runs used only `OGW_DEFAULT_DB=sqlite` with the server build data of `open-game-works-core-impl/server/build/data`, in a temporary copy of the checkout. PostgreSQL runs were not done.
