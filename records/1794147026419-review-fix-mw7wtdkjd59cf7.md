# review fix storage round 1

## done

- `storage` (server): `SqliteAdapter.open` now runs `PRAGMA busy_timeout = 0` as one synchronous DB call of the `DbMeter`, and runs the whole `set_wal` loop (every `PRAGMA journal_mode = WAL` try and the `Atomics.wait` pauses between them) as another one. Element 0 of the `watch_db_wait` array is 1 for the whole time the thread blocks there, and `read_db_metrics().sync_calls` / `sync_wait_ms` include those statements and that wait (`server/core/storage/db/sqlite.ts:251`, `:255`, helper `SqliteAdapter.sync`)
- Test: `server/core/storage/tests/db-metrics.test.ts:142` (`SQLite open`). Another connection holds `BEGIN IMMEDIATE` on a file in rollback-journal mode for 300 ms, so `set_wal` waits for it. The test checks that the watcher thread sees element 0 at 1, that element 0 is 0 afterwards, that `sync_calls` is 2, that `sync_wait_ms` is at least the hold time, and that the journal mode ends as `wal`. Before the fix this test failed (`expected false to be true` on the watcher), and after the fix it passes
- `ogw core test server` over storage and every server module that `ogw core dependents storage` lists: all pass. `ogw code check core`: type check, lint, dependency and secret all pass
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

none

## review

- R1-1: fixed. `server/core/storage/db/sqlite.ts:251` (busy timeout statement through `meter.sync`) and `server/core/storage/db/sqlite.ts:255` (the whole `set_wal` loop as one `meter.sync` call, so the state does not drop to 0 during the pauses between tries). Added test `server/core/storage/tests/db-metrics.test.ts:142` `SQLite open > element 0 is 1 while setting the WAL journal mode waits for another connection to the same file, ...`

## unverified

- The `set_wal` wait is still bounded by a number of tries (`ceil(open_wait_ms / 5)`), not by measured real elapsed time, so it can run past `storage.schemaLockWaitMs` by the run time of the tries (review `## unknown`). This was not a finding, so it was not changed or measured
- A failure of the open statements (for example `set_wal` giving up after its wait) is not added to `lock_failures` / `connection_failures`. The spec counts statements, `lock_game_row` calls and transaction starts, and does not say whether the open statements are included. The finding did not cover this, and it was left as it was
- `new DatabaseSync(...)` (opening the file handles) is not metered: it is not a statement, and the spec lists only statements for SQLite
