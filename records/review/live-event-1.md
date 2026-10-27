# review: live-event round 1

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

- The range cf89b7fd..17bbc048 changes no file in `server/core/live-event/`, `server/core/server-time/` or `server/core/logging/`, and does not change the storage operations live-event calls (`get_state`, `list_state`, `put_core_state`, `run_user_transaction`, `with_hook_change_source`, `check_hook_output`; `server/core/live-event/index.ts:11`). The changes checked for an effect on live-event: `sweep_expired` batches and its `SweepResult` (`server/core/storage/rows.ts`, `server/core/routing/routing_module.ts:156`), the expiry column index and `CREATE INDEX IF NOT EXISTS` of `register_table` (`server/core/storage/schema.ts:190`), the settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, and the PostgreSQL code `POOL` of a transaction that got no free connection (`server/core/storage/db/pg_messages.ts:53`, `server/core/storage/db/postgres.ts:19`). live-event registers no table and uses no expiry. Before the change the pool wait failure code `55P03` was already in `LOCK_CODES`, so `run_user_transaction` gives the same `FAILED` for it, and `on_request_start` handles `FAILED` with an `error` log (`server/core/live-event/index.ts:279`). The `routing.ipRateLimitPerMinute` default and the ads-reward, routing and storage test changes do not reach live-event. None of these changes causes or reveals a problem in live-event
- The live-event core tests were not run. Run with plain `node --test` in a temporary copy, they stop at load with `afterEach is not defined` and need the `OGW_*` inputs and the core test data build that `ogw core test` gives (`server/core/testing/dev/runner_input.ts:30`). Whether they pass on SQLite and PostgreSQL after this range was not checked by running them
- The data rules of `## data` (`server does not start` on a rule violation, `prod_change`) are data checks of the data tool; `tools/data-tool/src/checks/live-event.ts` was not reviewed because it is outside this target and the range does not change it
