# review rating round 1

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

- The range cf89b7fd..cfa7b982 does not change `server/core/rating/`, `server/generated/`, `test-data/` or the code of the modules `rating` depends on other than `storage`. The `ranking`, `mailbox`, `validation`, `logging` and `matchmaker` code is not changed; the only `mailbox` change is the test `server/core/mailbox/tests/broadcast.test.ts:123`, which reads the new `sweep_expired` result type
- The `storage` changes of the range are `sweep_expired` (batch deletes, `SweepResult` return type, `server/core/storage/rows.ts:384`), the expiry column index of registered tables (`server/core/storage/schema.ts:190`), `CREATE INDEX IF NOT EXISTS` (`server/core/storage/schema.ts:201`), the PostgreSQL code `NO_FREE_CONNECTION` = `POOL` counted in the lock failure codes (`server/core/storage/db/pg_messages.ts:53`, `server/core/storage/db/postgres.ts:19`) and the settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`. `rating` uses only `get_state`, `list_state` and `put_core_state` of `storage` (`server/core/rating/index.ts:20`), registers no table and calls no `sweep_expired`, so these changes reach `rating` only through the generic request transaction failure handling, which is not `rating` behavior. No finding came from these changes
- The other changes of the range are `ads-reward`, `routing` (storage sweep job logging), test-only edits of other modules, client core, `core-spec/` of `storage` and `ads-reward`, settings files and `records/`. `rating` does not import them
- Because the range does not reach `rating`, the code of `server/core/rating/` was not reviewed again for problems that existed before the range
- The `rating` core tests (8 files, 28 tests) were run with vitest only with `OGW_DEFAULT_DB` `sqlite`, on a copy of `open-game-works-core-impl/` at cfa7b98 in a temporary folder, with the `server/build/data` of `open-game-works-core-impl/`. They all passed. The PostgreSQL run was not done, because no PostgreSQL connection was set up for this review
