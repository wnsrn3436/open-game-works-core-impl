# review friend round 1

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

- No file of `server/core/friend/` changed in the commit range. The range changes `storage` (a dependency): `sweep_expired` batches and its `SweepResult` return, `register_table` adding the expiry column index, `CREATE INDEX IF NOT EXISTS`, and the PostgreSQL pool wait code `POOL`. These were read against the friend code. `friend_link` and `friend_count` are registered with expiry column `null` and no index list (server/core/friend/index.ts:419), so `with_expiry_index` adds no index and `sweep_expired` does not touch them. The pool wait is still in `LOCK_CODES` (server/core/storage/db/postgres.ts:19), so a pool wait on a count row still makes `lock_game_row` `FAILED` and friend still answers `INTERNAL`, as before the range. The `register_table` argument order (server/core/storage/index.ts:443) matches the friend call
- The `routing` changes in the range (storage_sweep error logs, `routing.ipRateLimitPerMinute`, `adUnits`) and the `ads-reward`, `QACore` and `ogw-secure-storage` changes do not reach friend code and were not checked further
- All 43 friend tests pass on SQLite (vitest with globals and the forks pool, `OGW_DEFAULT_DB=sqlite`). They were not run on PostgreSQL, because no PostgreSQL server was running on this host. The runs used `open-game-works-core-impl/server/build/data` as `OGW_SERVER_DATA`, because this checkout has no built data
