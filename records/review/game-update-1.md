# review: game-update round 1

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

- The range `cf89b7fd..cfa480cf` changes no file under `server/core/game-update/` and does not change `core-spec/game-update.json`. The changes checked for their effect on game-update are those of its dependency `storage` (`server/core/storage/rows.ts` `sweep_expired` batch delete, `server/core/storage/schema.ts` expiry index and `CREATE INDEX IF NOT EXISTS`, `server/core/storage/db/pg_messages.ts` and `server/core/storage/db/postgres.ts` `NO_FREE_CONNECTION` code `POOL` added to the lock codes, `storage.sweepBatchSize` and `storage.sweepTableBudgetMs` settings) and of `routing` (`server/core/routing/routing_module.ts` `storage_sweep` job). The three game-update tables are registered without an expiry column and without indexes (`server/core/game-update/index.ts:87`), so the sweep and index changes do not reach them; a free connection wait is a lock failure before and after the range (`55P03` was a lock code), so `lock_game_row` in `publish_deploy_list` and `prune_update_files` (`server/core/game-update/admin.ts:149`, `server/core/game-update/admin.ts:168`) keeps the same result
- The game-update core tests were run only with `OGW_DEFAULT_DB=sqlite` (9 files, 74 tests passed). The run with `OGW_DEFAULT_DB=postgresql` was not done because no PostgreSQL connection was given to this review. `OGW_SERVER_DATA` was the built data of `open-game-works-core-impl/server/build/data`, not data built from this checkout
- `server/core/game-update/adapters/cdn_r2.ts` and `server/core/game-update/signing.ts` were not read, because the range does not change them or anything they call
