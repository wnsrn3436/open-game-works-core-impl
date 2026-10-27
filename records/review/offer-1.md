# review: offer round 1

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

- The range cf89b7fd..d936f66 changes no file under `server/core/offer/`, and no file of `live-event`, `validation`, `server-time` or `logging` under `server/core/` (`git diff --stat` of the range on those folders is empty). `## spec changes` is `none`. The storage changes in the range were checked against the offer code: `sweep_expired` now returns `SweepResult` and deletes in batches (`server/core/storage/rows.ts:385`), `table_def` adds an expiry column index and `CREATE INDEX IF NOT EXISTS` (`server/core/storage/schema.ts:177`), the settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs` were added (`server/core/storage/core.ts:28`), and `NO_FREE_CONNECTION` became `POOL` and a lock code (`server/core/storage/db/postgres.ts:19`). offer reads and writes only `OfferUserState` through `get_state`, `put_core_state` and `delete_core_state` (`server/core/offer/index.ts:84`, `server/core/offer/index.ts:100`, `server/core/offer/index.ts:176`), whose signatures and behavior the range did not change, and it calls none of the changed operations. None of these changes causes or reveals a problem in offer
- The offer tests (`server/core/offer/tests/`, 26 tests) were run with the vitest of the harness tool, globals on, `OGW_DEFAULT_DB` `sqlite`, and all passed. The server data came from `open-game-works-core-impl/server/build/data` (this worktree has no `server/build/`), so the data used may differ from data built from this commit. The `postgresql` run was not done: no PostgreSQL connection string was available here
- Client `UserStateCore.is_offer_active` and `get_offer_ends_at`, which `## behavior` says do the same calculation, are client core and outside this server module target; they were not checked
- The `## data` rules (`duration`, `cooldown`, `max_triggers`, `duration` + `cooldown`) are data checks (`skills/core/SKILL.md` `## data used by core`) in `tools/data-tool/src/checks/offer.ts`. The data tool is not the target, and that check and its tests were not reviewed
