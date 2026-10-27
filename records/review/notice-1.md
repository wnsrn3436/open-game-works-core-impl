# review notice round 1

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

- The commit range `cf89b7f..23a428c` changes no file of the server `notice` module (`server/core/notice/index.ts`, `server/core/notice/select.ts`, `server/core/notice/tests/`) and no `core-spec/notice.json`; `git log cf89b7f..23a428c -- server/core/notice core-spec/notice.json` is empty. Input `## spec changes` is `none`. The review therefore checked only how the changed code reaches `notice`
- Checked how the changes reach `notice`:
  - `storage` expiry sweep (`server/core/storage/rows.ts:385`): `sweep_expired` now deletes in batches of `storage.sweepBatchSize` per table, each in its own autocommit, stops a table at the end of `storage.sweepTableBudgetMs`, and returns `{ deleted, failed }`. `notice_notice` is a sweep target because `notice` registers it with expiry column `end_at` (`server/core/notice/index.ts:456`). The batch delete keeps the condition `end_at <= now` on the outer delete (`server/core/storage/rows.ts:375`), so it deletes no live notice. `notice` does not depend on the rows being gone: every read filters `end_at > now` (`server/core/notice/index.ts:62`, `:63`, `:64`), so a table left unfinished at its time budget or with a `FAILED` delete keeps the `list_notices`, `GetNotices`, `put_notice`, `delete_notice` and `notice.maxStoredNotices` results of `notice` spec `### storage and cache`. `notice` never calls `sweep_expired`
  - `storage` schema (`server/core/storage/schema.ts:191`): `table_def` now adds the index `[end_at]` to `notice_notice`, since `notice` passes no index list. On an existing DB, `apply_table` (`server/core/storage/schema.ts:295`) creates only the indexes not in the stored definition and appends them, and `conflict` does not compare indexes, so an existing `notice_notice` gets the index without a start failure. `create_index_sql` now uses `IF NOT EXISTS`. `notice_sequence` has no expiry column and is unchanged
  - `storage` PostgreSQL adapter (`server/core/storage/db/postgres.ts:19`, `server/core/storage/db/pg_messages.ts:53`): a wait for a free connection is now code `POOL` and counts as a lock failure. `notice` sees it only as `lock_game_row` or the admin transaction returning `FAILED`, mapped to `internal` (`server/core/notice/index.ts:368`, `:401`, `:428`), the same as before
  - `routing`: `storage_sweep` now logs one error per failed table (`server/core/routing/routing_module.ts:166`); `MODULE_CORE_RPCS` still maps `notice` to `GetNotices` (`server/core/routing/spec_tables.ts:131`) and `NO_USER_RPC` is unchanged. The core settings default `routing.ipRateLimitPerMinute` went from 60 to 300 (`settings/core-settings.json:95`); the IP counter of `GetNotices` is a routing step, and the test of the `GetNotices` IP limit (`server/core/routing/tests/processing-order.test.ts:485`) sets the limit to 2 itself, so it does not depend on the default
  - `admin-api`, `validation`, `server-time`, `logging`, contract: no file of these modules and no file under `server/generated/` or `proto/` changed in the range
  - Test support: `server/core/notice/tests/` imports `server/core/testing/dev/index.ts` and generated files. In `testing/dev`, only `setting_types.ts` changed, where it adds the types of `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`
- The `notice` core tests were not run in this review; the conclusion above comes from reading the code
- `notice` code outside the range was read only to find its calls into the changed modules. It was not checked for problems that existed before the range
- The storage sweep changes themselves (batch SQL on PostgreSQL and SQLite, time budget, failure codes) were not checked: they belong to the `storage` review
