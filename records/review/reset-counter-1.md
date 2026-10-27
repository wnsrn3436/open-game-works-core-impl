# review reset-counter round 1

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

- The commit range cf89b7fd..50659bf changes no file of `server/core/reset-counter/`, `server/core/server-time/`, `test-data/`, `tools/` or `proto/`. Its server changes are the `storage` expiry sweep (`server/core/storage/rows.ts` `sweep_expired` batch deletes and failed table list, `server/core/storage/schema.ts` expiry column index and `CREATE INDEX IF NOT EXISTS`, settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`), the PostgreSQL pool wait code `POOL` classified as a lock failure (`server/core/storage/db/pg_messages.ts:53`, `server/core/storage/db/postgres.ts:19`), the `routing` `storage_sweep` job logs and `routing.ipRateLimitPerMinute` 300, and `ads-reward`. reset-counter calls only `storage.get_state` and `storage.put_core_state` and `server-time.now` and `get_next_reset` (`server/core/reset-counter/index.ts:11`, `:14`), which the range does not change. `ResetCounterUserState` is a UserState kind without an expiry column, so `sweep_expired` (targets `game_state` and registered tables with an expiry column, `server/core/storage/rows.ts:386`) does not delete its rows. No change of the range reaches reset-counter behavior
- `ogw core test server reset-counter` was run on this checkout (job mvqlkjne435f85): 26 of 26 passed. The rest of the server suite was not run
- Client `UserStateCore.get_reset_counter` (`## behavior`) is outside this server module target and was not checked
- The path by which a failed data check (`limit` 0, `out_of_range`) stops server start was not traced, as the range does not change it
