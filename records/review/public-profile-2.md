# review public-profile round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | efficiency | medium | server/core/public-profile/index.ts:210 | Debt D4, still open. `get_public_profiles` calls `storage.get_user_record` once per input user ID inside the `filter` at :209-214, and each call is one `SELECT ... FROM "user" WHERE user_id = $1` query (server/core/storage/rows.ts:88). `get_public_profiles` has no limit on the user ID count (spec `## behavior`), so the query count grows with the length of the list the caller passes, e.g. the channel list at server/core/chat/index.ts:398 and the block list at server/core/block-report/index.ts:431. No module code changed in this range. The storage spec says the `user` table is read only with `get_user_record`, `find_user_by_public_code`, `scan_users` and `sample_users` (open-game-works-core/skills/server-core/modules/storage.md:96), and public-profile `## behavior` names `get_user_record` as the source. | Add a `storage` read of the `user` rows for a list of user IDs, bounded per call, and have profile build and the `is_active_user` judgement in `get_public_profiles` call it once per group of `public-profile.maxRequestCount` (as in the spec proposal of the core agent report). | yes | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Test `find counter expiry > has expires_at at the window end, ...` (server/core/public-profile/tests/profiles.test.ts:287). In a temporary copy outside the checkout, `[user_id, window_start, window_start + MINUTE_MS]` → `[user_id, window_start, window_start]` was changed at server/core/public-profile/index.ts:267. That test and `has no row of a finished window after storage.sweep_expired` then fail (2 failed / 16 passed, OGW_DEFAULT_DB=sqlite); the unchanged copy passes 18/18. |
| R1-2 | fixed | Test `find counter expiry > has no row of a finished window after storage.sweep_expired` (server/core/public-profile/tests/profiles.test.ts:300). In a temporary copy, the expiry column `'expires_at'` → `null` was changed at server/core/public-profile/index.ts:171. That test then fails (1 failed / 17 passed, sqlite). |
| R1-3 | fixed | Test `user snapshot > has no public_profile_activity and public_profile_find_counter rows of a user that has both` (server/core/public-profile/tests/profiles.test.ts:315). In temporary copies, the snapshot flag `false` → `true` was changed at server/core/public-profile/index.ts:170 in one copy and at :171 in another. The test fails in each (1 failed / 17 passed, sqlite). It reads the snapshot rows with `storage.read_user_rows`, whose target rows the storage spec defines as the tables with snapshot flag `true`. |
| R1-4 | open | Became R2-1: server/core/public-profile/index.ts:209-214 still calls `storage.get_user_record` once per user ID, and `storage` still has no read of several `user` rows. |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | The restored defect `window_start + MINUTE_MS` → `window_start` at server/core/public-profile/index.ts:267 now fails server/core/public-profile/tests/profiles.test.ts:287 and :300 (see R1-1). |
| D2 | fixed | none | The restored defect, expiry column `null` at server/core/public-profile/index.ts:171, now fails server/core/public-profile/tests/profiles.test.ts:300 (see R1-2). |
| D3 | fixed | none | The restored snapshot flag `true` at server/core/public-profile/index.ts:170, and separately at :171, now fails server/core/public-profile/tests/profiles.test.ts:315 (see R1-3). |
| D4 | open | R1-4 | Code at server/core/public-profile/index.ts:209-214 unchanged; one `get_user_record` query per input user ID. The finding is R2-1. |

## must fix

none

## unknown

- Of the commit range, only the changes under `server/core/public-profile/` (tests only, in `profiles.test.ts`) belong to this target. The other changed files (mission, client core, records of other modules) were not reviewed.
- The mutation runs used only `OGW_DEFAULT_DB=sqlite`, with the server build data of `open-game-works-core-impl/server/build/data`, and ran only `server/core/public-profile/tests/profiles.test.ts`. The PostgreSQL runs were not done. The core agent report states the PostgreSQL runs passed and failed as expected; this was not repeated.
- In this ad hoc copy, `server/core/public-profile/tests/requests.test.ts` failed at server start (`server-time: setting dailyResetOffsetMs is not an integer`) because the setup lacks inputs that `ogw core test` gives. It was not used for any judgement and is unrelated to the changes.
- No full `user-snapshot-clone` snapshot run was made for R1-3. The test checks `storage.read_user_rows`, which the snapshot uses.
