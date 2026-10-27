# review loot-table round 1

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

- The range cf89b7fd..e71bd8c changes no file under `server/core/loot-table/`. The changes it does make were checked against what loot-table calls: `storage` (`server/core/storage/rows.ts`, `server/core/storage/index.ts`, `server/core/storage/core.ts`, `server/core/storage/schema.ts`, `server/core/storage/db/postgres.ts`) changes only `sweep_expired`, its new settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, and the `NO_FREE_CONNECTION` code. `random_weighted`, `RequestCtx` and the `Storage` members in `LootStorage` (`server/core/loot-table/index.ts:12`) did not change. `item-ledger` changes only `server/core/item-ledger/tests/history.test.ts`, so `amount_limit`, `read_amount` and `make_item_amount` (`server/core/loot-table/index.ts:15`) did not change. `logging` did not change. `settings/core-settings.json` adds the two storage keys with defaults, so the test server in `server/core/loot-table/tests/helpers.ts:52` starts with them, and `loot-table.maxRollCount` did not change
- The loot-table tests were not run. `npx vitest run core/loot-table` fails before collecting tests with `testing: the server build data folder null does not exist` (`server/core/testing/dev/runner_input.ts:47`), because the server build data comes from the harness runner (`ogw core test`) and is not available to this agent. `ogw review run` runs the core tests of the modules that depend on the changed modules
