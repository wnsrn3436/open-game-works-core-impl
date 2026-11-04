# review notice round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | server/core/notice/index.ts:406 | (debt D1) The replace path is the same as in the debt item. `put_notice` with `notice_id` ≠ 0 takes `lock_game_row` on `notice_notice` (index.ts:401) and checks the row with `SELECT_LIVE_ONE` (`... WHERE notice_id = $1 AND end_at > $2`, index.ts:63, 402). That SELECT takes no row lock, and `storage` `### expiry` says `sweep_expired` takes no `lock_game_row` lock. Then `UPDATE_NOTICE` (index.ts:66-68, `... WHERE notice_id = $1`) runs at index.ts:406, and its result is not looked at. Run path on PostgreSQL READ COMMITTED: notice with `end_at` just after `now`; `SELECT_LIVE_ONE` sees it; the clock reaches `end_at`; `storage_sweep` deletes the row and commits; `UPDATE_NOTICE` changes 0 rows; the handler returns `{notice_id}`, admin-api stores that success for the `operation_id`, and `after_commit` (index.ts:407-411) puts the record in the cache of this instance until the next `notice_cache` run. The notice is lost but the operator got success. Read from the code; the window is between two statements, so it was not reproduced in a run | Make the replace one statement whose row count is checked (e.g. `UPDATE ... WHERE notice_id = $1 AND end_at > $now RETURNING notice_id`, or an upsert), and return `not_found` when it changed no row | no | 85 |
| R1-2 | test evidence | medium | server/core/notice/tests/target.test.ts:74 | (debt D2) `## API` of `notice` sets `INVALID_REQUEST` for `GetNotices` and `max_len` 35 for `GetNoticesRequest.language` (proto/ogw/core.proto:1183). No test sends a `GetNoticesRequest` with a `language` over 35 bytes: server/core/notice/tests/helpers.ts:100 defaults to `en`, target.test.ts:66-77 uses `ko`, `KO`, `Ko`, `EN`, `fr`, `ko-KR` and `''`, and server/core/routing/tests/processing-order.test.ts:247, 488 and server/core/testing/tests/request.test.ts:125 send an empty `GetNoticesRequest`. The only 36-byte `language` test, server/core/validation/tests/validator.test.ts:69-74, checks `RegisterPushTokenRequest`. So removing `max_len` from core.proto:1183 fails no test | Add a `GetNotices` test whose `language` is 36 bytes and that expects `INVALID_REQUEST`, plus one at 35 bytes that succeeds with the `sourceLanguage` text | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/notice/index.ts:401-406 still checks with an unlocked `SELECT_LIVE_ONE` and then runs `UPDATE_NOTICE` without checking its row count. The commit range is empty, so the code is the same as when the debt item was written |
| D2 | open | R1-2 | No test in server/core/notice/tests/, server/core/routing/tests/processing-order.test.ts or server/core/testing/tests/request.test.ts sends a `GetNoticesRequest.language` over 35 bytes. The `max_len` test in server/core/validation/tests/validator.test.ts:69-74 covers `RegisterPushTokenRequest` only |

## must fix

none

## unknown

- The commit range fdef2b5..fdef2b5 is empty, so no changed code was reviewed. Only the input `## debt` items were checked
- R1-1 was not reproduced on PostgreSQL. The interleaving was found by reading the code and the `storage` `### expiry` rule. On SQLite, whether the game transaction holds the DB write lock from its first write, which would block the sweep, was not checked
- R1-2 was not checked by removing `max_len` and regenerating the contract. It was checked by finding every place a test sends `GetNoticesRequest` (grep over server/)
