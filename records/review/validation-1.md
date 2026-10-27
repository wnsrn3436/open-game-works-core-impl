# review: validation round 1

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

- The range cf89b7fd..319d929 changes no file under `server/core/validation/`, and no file under `server/core/item-ledger/` other than `server/core/item-ledger/tests/history.test.ts:1` (test only). The changed code the module reaches is in `storage`: `sweep_expired` and `SweepResult` (`server/core/storage/rows.ts`), the added expiry index and `CREATE INDEX IF NOT EXISTS` (`server/core/storage/schema.ts`), the new settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs` (`server/core/storage/core.ts`), and `NO_FREE_CONNECTION` changing from `55P03` to `POOL` while staying in `LOCK_CODES` (`server/core/storage/db/pg_messages.ts`, `server/core/storage/db/postgres.ts`). validation calls none of these. It uses only the `RequestCtx`/`Storage` types and, through judge hooks, `run_read_only`, `get_state` and `item-ledger.get_balance`, and the range did not change how those behave. So these changes cause or reveal no validation finding
- `ogw core test server validation` passed on 319d929. This review did not re-check the whole module for problems that existed before the range (the commit range is not `none`)
