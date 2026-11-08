# review storage round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/storage/db/sqlite.ts:273 | `### DB adapter` synchronous DB call (skills/server-core/modules/storage.md:315): "On SQLite, these are every statement". storage.md:306 also says that setting the WAL journal mode when the connection opens blocks the thread for up to `storage.schemaLockWaitMs`. `SqliteAdapter.open` runs `PRAGMA busy_timeout = 0` (sqlite.ts:251) and every `PRAGMA journal_mode = WAL` try of `set_wal` (sqlite.ts:273, with the `Atomics.wait` pause between tries at sqlite.ts:276) straight on the raw `DatabaseSync`, outside `Connection.call` and so outside `DbMeter.sync` (meter.ts:73). `watch_db_wait` is called before `begin_start` (index.ts:582, routing.md:50), and `begin_start` runs `adapter.open()` (index.ts:352). Run path: three worker server instances start on one new SQLite file, the case that `set_wal` handles (db-adapter.test.ts `SQLite open`). One instance's thread blocks in `set_wal` for up to 30000 ms (`storage.schemaLockWaitMs`). Element 0 of its front link array stays 0 for that whole time, and `read_db_metrics().sync_calls` and `sync_wait_ms` leave those statements and that wait out | Run the open statements through the meter: wrap the `busy_timeout` statement and the whole `set_wal` loop (the tries and their pauses, as the thread blocks for all of it) in `meter.sync`, or open the write `Connection` first and run them through it. Add a test that element 0 is 1 while `set_wal` waits for another connection | no | 80 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- PostgreSQL: this run has no `OGW_POSTGRESQL`, so `ogw core test server storage` ran `db-metrics.test.ts` and `random.test.ts` on SQLite only (both pass). The PostgreSQL tests of `db-metrics.test.ts` and the PostgreSQL paths of `Bridge.call_sync` metering, `counting_adapter` failure counts and `wal_archive_failing` were checked by reading the code only
- `db-adapter.test.ts` (`SQLite open`) was not run; `set_wal` was checked by reading the code
- Only the storage files that the range changed were reviewed (`core.ts`, `db/meter.ts`, `db/postgres.ts`, `db/sqlite.ts`, `dev/index.ts`, `index.ts`, `tx.ts` and their tests), plus the code they call (`DbHandle.query`, `mark_broken`, `open_user`, `complete_start`, `stop`). Callers outside storage (`routing` front link, `logging` metrics, `testing` check seed provider) were not reviewed beyond their calls into storage
- The total `set_wal` wait is bounded by a try count (`ceil(open_wait_ms / 5)` tries, each with a 5 ms pause), not by measured real elapsed time. So the wait can run longer than `storage.schemaLockWaitMs` by the run time of the tries. Not measured
