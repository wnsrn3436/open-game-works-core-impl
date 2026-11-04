# review public-profile round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/public-profile/index.ts:267 | Debt D1. `### find by public code` sets `expires_at` of `public_profile_find_counter` to the window end, and no test checks it. In a temporary copy outside the checkout, `[user_id, window_start, window_start + MINUTE_MS]` was replaced with `[user_id, window_start, window_start]`; all 35 tests of `server/core/public-profile/tests` still pass (OGW_DEFAULT_DB=sqlite). With that change a `storage.sweep_expired` run inside the window deletes the row and the count restarts below `public-profile.findPerMinute`. | Add a test: with `public-profile.findPerMinute` 1, `count_find_attempt`, `storage.sweep_expired` inside the same window, then `count_find_attempt` is `RATE_LIMITED`; and/or assert `expires_at` = window start + 60000 of the row. | no | 90 |
| R1-2 | spec | medium | server/core/public-profile/index.ts:171 | Debt D2. The expiry column `expires_at` of `public_profile_find_counter` (`### find by public code` table) has no test. In a temporary copy, `register_table(FIND_COUNTER_TABLE, ..., 'expires_at', false)` was changed to `null` for the expiry column; all 35 public-profile tests still pass, and with it the row of a finished window stays after `storage.sweep_expired`. | Add a test that advances the clock past the window end, runs `storage.sweep_expired` and finds no `public_profile_find_counter` row of that user. | no | 90 |
| R1-3 | spec | medium | server/core/public-profile/index.ts:170 | Debt D3. Snapshot flag `false` of `public_profile_activity` and `public_profile_find_counter` (`### last active`, `### find by public code`) has no test. In a temporary copy both flags at server/core/public-profile/index.ts:170 and :171 were changed to `true`; the 35 tests of `server/core/public-profile/tests` and the 81 tests of `server/core/user-snapshot-clone/tests` still pass. No other test file under `server/core` names these tables (`grep -rl` of both table names and `ACTIVITY_TABLE`/`FIND_COUNTER_TABLE` finds only files in `server/core/public-profile/`). | Add a test that takes a user snapshot (or reads the registered snapshot flag through `storage`) of a user with rows in both tables and finds neither table in it. | no | 90 |
| R1-4 | efficiency | medium | server/core/public-profile/index.ts:210 | Debt D4. `get_public_profiles` calls `storage.get_user_record` once per input user ID inside the `filter` at :209-214, and each call is one `SELECT public_code, created_at, withdrawn_at FROM "user" WHERE user_id = $1` (server/core/storage/rows.ts:88). `get_public_profiles` has no limit on the user ID count (spec `## behavior`), so the query count grows with the list the caller passes, e.g. the channel list at server/core/chat/index.ts:398 and the block list at server/core/block-report/index.ts:431. Code unchanged since the debt was written. `storage` has no read of several `user` rows (storage spec: the `user` table is read only with `get_user_record`, `find_user_by_public_code`, `scan_users`, `sample_users`) and `## behavior` of public-profile names `get_user_record` as the source. | Add a `storage` read of the `user` rows of a list of user IDs (bounded per call) and have profile build and `is_active_user` judgement in `get_public_profiles` use it once per group of `public-profile.maxRequestCount`. | yes | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | Code at server/core/public-profile/index.ts:267 unchanged; the mutation `window_start + MINUTE_MS` → `window_start` in a temporary copy leaves all 35 public-profile tests passing. |
| D2 | open | R1-2 | Code at server/core/public-profile/index.ts:171 unchanged; expiry column `null` in a temporary copy leaves all 35 public-profile tests passing. |
| D3 | open | R1-3 | Flags at server/core/public-profile/index.ts:170-171 unchanged; both set to `true` in a temporary copy leaves 35 public-profile tests and 81 user-snapshot-clone tests passing. |
| D4 | open | R1-4 | server/core/public-profile/index.ts:209-214 still calls `storage.get_user_record` per user ID; `storage` still has no multi-row `user` read. |

## must fix

none

## unknown

- The commit range f4d24ea..f4d24ea is empty, so no changed code was reviewed; the review covered only the input `## debt` items. The rest of the module was not reviewed again for new problems.
- The mutation runs used `OGW_DEFAULT_DB=sqlite` only, with the server build data of `open-game-works-core-impl/server/build/data`; the PostgreSQL run was not done. The baseline copy passed all 35 public-profile tests under the same setup.
- The query counts of D4 (1, 3, 6, 12 calls) were not measured again; the per-ID call was checked by reading the unchanged code.
