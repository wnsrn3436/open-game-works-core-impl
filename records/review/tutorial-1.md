# review: tutorial round 1

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

- The range cf89b7fd..a5c3cb5 changes no file of `server/core/tutorial/`, no contract and no core test data. The changes that tutorial calls or depends on were read: `storage` `sweep_expired` now deletes in batches and returns a failed-table list (`server/core/storage/rows.ts:385`); `table_def` now adds an index on the expiry column and uses `CREATE INDEX IF NOT EXISTS` (`server/core/storage/schema.ts:177`); new settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs` (`server/core/storage/core.ts:319`, `settings/core-settings.json:485`); the `routing` `storage_sweep` job logs each failed table (`server/core/routing/routing_module.ts:156`); `routing.ipRateLimitPerMinute` goes from 60 to 300. `tutorial` calls only `get_state`, `put_core_state`, `delete_core_state`, `logging.write` and `logging.track_core_event` (`server/core/tutorial/index.ts:10`, `server/core/tutorial/index.ts:13`), and none of these changed. `TutorialProgressUserState` is kept in the base table `user_state`, which has no expiry column (`server/core/storage/schema.ts:215`), so the sweep does not reach it. The tutorial tests start the test server from core settings (`server/core/tutorial/tests/helpers.ts:48`), and core settings now include the two new storage keys that `read_settings` requires
- The tutorial core tests were not run: there is no `node_modules` in `server/` of this checkout, and `npm ci` would write files outside `output`. Whether they pass after the range is judged only by reading the code
