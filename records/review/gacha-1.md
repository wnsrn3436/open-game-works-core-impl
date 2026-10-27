# review gacha round 1

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

- The commit range cf89b7fd2768ede33b78f5948fb0fae06df506e2..b60079e07de0c08feedce7c0530d57e4079da44f changes no file under `server/core/gacha/`. These changes reach gacha and were checked for their effect on it:
  - storage `sweep_expired` (`server/core/storage/rows.ts`) now deletes in batches by `rowid`/`ctid`, each batch in its own transaction, and returns `{ deleted, failed }`. The gacha record table registers expiry column `expires_at` (`server/core/gacha/records.ts:55`), so it is a sweep target. gacha only inserts rows. `draw_seq` is the user's `MAX(draw_seq) + 1` taken in the insert statement (`server/core/gacha/records.ts:28`), and expired rows that have not been swept yet still count. A batch delete leaves `draw_seq` unique per user and still matches the gacha spec rule "the largest value among that user's draw records + 1, or 1 when there is no draw record". Every gacha read filters `expires_at > clock_now` (`server/core/gacha/records.ts:35-42`), so a sweep that is partial, stopped by its time budget or `FAILED` changes no gacha result
  - `table_def` `with_expiry_index` (`server/core/storage/schema.ts:191`) adds the index `(expires_at)` to the gacha record table, because neither of its indexes `(user_id, banner_id, draw_seq)` and `(user_id, drawn_at)` starts with `expires_at`. That matches the storage spec `register_table` rule. The update path of `apply_schema` (`server/core/storage/schema.ts:310-312`) creates the index on an existing gacha record table with `CREATE INDEX IF NOT EXISTS`
  - routing `storage_sweep` now writes an error log per failed table, and the `sweep_expired` return type changed. gacha code and gacha tests do not call `sweep_expired` directly. `history.test.ts` "rows past the retention period are gone" drives the sweep through the `storage_sweep` job and checks the stored rows with a direct SQL read
  - `pg_messages.ts`/`postgres.ts` `NO_FREE_CONNECTION` (`POOL`), `routing.ipRateLimitPerMinute` default 300, and the new settings `storage.sweepBatchSize`/`storage.sweepTableBudgetMs`: gacha does not read them
- The gacha core tests were run only with `OGW_DEFAULT_DB=sqlite`: `server/core/gacha/tests`, 5 files, 36 tests, all passed. They ran with vitest from the harness tools, with `OGW_CORE_FIXTURES` set to this checkout's `fixtures`. `OGW_SERVER_DATA` was the existing `open-game-works-core-impl/server/build/data`, because this checkout has no `server/build/data`. That build data was not rebuilt from this checkout's `test-data`, although `test-data` has no changes in this range. The PostgreSQL run was not done because no PostgreSQL connection was prepared for this review
- The commit range is set and `## spec changes` is `none`, so this round did not review the gacha code from before the range against the spec
