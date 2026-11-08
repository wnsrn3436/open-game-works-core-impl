# review storage round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `server/core/storage/db/sqlite.ts:251` runs `PRAGMA busy_timeout = 0` through `SqliteAdapter.sync` (`meter.sync`, `server/core/storage/db/sqlite.ts:288`), and `server/core/storage/db/sqlite.ts:255` runs the whole `set_wal` loop (every `PRAGMA journal_mode = WAL` try and the `Atomics.wait` pauses) inside one `meter.sync`. `DbMeter.sync` (`server/core/storage/db/meter.ts:35`) stores 1 in element 0 before the call and 0 in `finally`, and adds the call and its real elapsed time, so element 0 is 1 for the whole blocking open and `sync_calls` / `sync_wait_ms` include it. A throw from `set_wal` still resets element 0 (`finally`) before `open` converts it to `DbError('connection', ...)`. Test `server/core/storage/tests/db-metrics.test.ts:142` (`SQLite open`) passes (`ogw core test server storage --file server/core/storage/tests/db-metrics.test.ts`: storage pass). Restored defect: in a `git worktree add --detach` copy of HEAD, `server/core/storage/db/sqlite.ts` was replaced with its content at `4491197d` (open statements run directly on `DatabaseSync`), and the same test failed: `SQLite open > element 0 is 1 while setting the WAL journal mode waits ... AssertionError: expected false to be true` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- PostgreSQL: this run has no `OGW_POSTGRESQL`, so `db-metrics.test.ts` ran on SQLite only. The range does not change the PostgreSQL adapter
- Only `db-metrics.test.ts` was run (on the fixed code and on the restored copy). The core agent report says the tests of storage and of its dependents pass after the fix. This review did not run them again
- The fix counts the whole `set_wal` loop as one synchronous DB call, so `sync_calls` grows by 1 however many `PRAGMA journal_mode = WAL` tries run. Its pauses count in `sync_wait_ms`, and element 0 stays 1 during them. storage.md:315 counts every SQLite statement as a synchronous DB call and leaves out only the waits between `BEGIN IMMEDIATE` tries, which do not block the thread. storage.md:306 calls setting the WAL journal mode one synchronous step that blocks the thread. The spec does not say whether each WAL try counts as its own call, or whether a pause between tries that blocks the thread is part of the DB wait. I could not reach 80 confidence that the fix differs from the spec, so this is not a finding. The round 1 fix direction proposed this same wrapping
- A failure of the open statements (e.g. `set_wal` giving up after `storage.schemaLockWaitMs`) is not added to `lock_failures` / `connection_failures` (`counting_adapter.open`, `server/core/storage/db/meter.ts:126`). This was already the case before the range, and server start fails in that case. Not checked further
- The total `set_wal` wait is bounded by a try count (`ceil(open_wait_ms / 5)`), not by measured real elapsed time. This was the same before the range. Not measured
