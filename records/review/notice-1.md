# review notice round 1

## findings

none

## previous

none

## out of scope

- server/core/notice/index.ts:406: medium `put_notice` of a stored `notice_id` answers success without storing anything when `sweep_expired` deletes the row between the live check and the `UPDATE`. Run path on PostgreSQL (`READ COMMITTED`): a notice is close to its `end_at`; `put_notice` takes `lock_game_row` and `SELECT_LIVE_ONE` (index.ts:402) sees the row with `end_at` > `clock_now`; the clock reaches `end_at`; `sweep_expired` of any server instance deletes the row, because the `storage` `### expiry` sweep takes no `lock_game_row` lock; `UPDATE_NOTICE` (index.ts:406) then changes 0 rows and its row count is not looked at. The handler returns `{notice_id}`, admin-api writes the `admin_api_operation` row so a retry with the same `operation_id` gets the same success, and `after_commit` puts the replaced notice in the cache of that server instance until the next `notice_cache` run, after which it is gone. An operator who extends a notice as it ends gets success and loses the notice. Found by reading the code path; the window is the gap between two statements, and it was not reproduced in a run. The fix direction is one upsert statement for the replace, or `not_found` when the `UPDATE` changed no row
- server/core/notice/tests/target.test.ts:74: medium No core test goes through the `INVALID_REQUEST` failure value that `## API` of `notice` sets for `GetNotices` with `language` over `max_len` 35. Every `GetNoticesRequest` sent in `server/core/notice/tests/`, `server/core/routing/tests/processing-order.test.ts` and `server/core/testing/tests/request.test.ts` has a default or short `language` (longest: `ko-KR`), so removing `max_len` from `proto/ogw/core.proto:1183` fails no test that those files hold

## debt

none

## must fix

none

## unknown

- The commit range changes no file of `server/core/notice/`, `core-spec/notice.json`, `proto/` or `server/generated/`, and no non-test file of `admin-api`, `validation`, `storage`, `server-time` or `logging`. The range changes that reach `notice` are `core-spec/validation.json`, `tools/data-tool/src/corespec.ts` (the table closure that `usedTables` `shortcut` of `notice` goes through) and the settings files. They were read and no problem of `notice` was found. The data tool tests were not run for this review; the data tool is its own review target
- `ogw core test server notice` passed. Which DB kinds that run used was not checked, so the PostgreSQL behavior of `server/core/notice/tests/id.test.ts` (the `lock_game_row` wait of the concurrent `put_notice` test) is not confirmed by this review. On SQLite, `BEGIN IMMEDIATE` serializes the writes whether or not that lock is taken, so that test can only show the lock on PostgreSQL
- The whole of `server/core/routing/` handling of `NoUserRpc` was not read. Only the `notice` entries of `spec_tables.ts`, `http.ts`, and the `GetNotices` tests of `processing-order.test.ts` were read
- No defect was restored in a temporary copy, because this is round 1 and has no `test evidence` finding to judge
