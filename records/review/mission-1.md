# review mission round 1

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

- The range cf89b7fd2768ede33b78f5948fb0fae06df506e2..33c28087058e5cf18e06724846efe4fea32c98b1 changes no file under `server/core/mission/`. The non-test changes that `mission` reaches are in `storage` (`server/core/storage/rows.ts` `sweep_expired` now deletes in batches with a per-table time budget and returns `{ deleted, failed }`, `server/core/storage/schema.ts` adds an index on the expiry column and `CREATE INDEX IF NOT EXISTS`, `server/core/storage/core.ts` new settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, `server/core/storage/db/pg_messages.ts` and `server/core/storage/db/postgres.ts` the pool wait code `POOL` that stays in the lock codes) and `routing` (`server/core/routing/routing_module.ts` the `storage_sweep` job logs per failed table, `server/core/routing/spec_tables.ts` `adUnits`). `mission` calls only `get_state`, `put_core_state`, `with_hook_change_source` and `check_hook_output` of `storage` (`server/core/mission/deps.ts:10`), none of which changed. `MissionProgressUserState` rows have no expiry column, so the sweep and expiry index changes do not reach them. The pool wait was `55P03` before the range and was already a lock code, so the lock classification that `routing` retries on for the `retry` rpc `ClaimMission` is unchanged. `item-ledger`, `mailbox`, `live-event`, `validation`, `server-time` and `logging` have no non-test code change in the range
- The core tests of `mission` were run one file at a time with `ogw core test server mission --file` (`claim.test.ts` 30/30, `progress.test.ts` 14/14, `reset.test.ts`, `start.test.ts` passed; recorded in `records/review/mission-1-runs.json`). The full `ogw core test server` run of the modules that depend on `storage` was not run by this review
- The client `UserStateCore.get_mission_progress` (the same round reset and lazy reset rules on the client) is not part of this server module target and was not checked
- The data rules of `mission.csv` (`target` range, empty `reward` with `extra_grant` `false`) are checked by the data tool, which is outside this target and was not read
