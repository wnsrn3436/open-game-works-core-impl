# review storage round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/storage/db/pg_worker.ts:427 | `open-game-works-core/skills/server-core/modules/storage.md:303` says a `read_db` statement that meets a DB connection failure or PostgreSQL ending its connection, on a connection open before the statement, runs once more on a new connection. The range adds this retry (`opened_before` / `connection_ended` in `query`, lines 427-433), but no test makes a `read_db` statement meet that end while it runs. The only tests that end the read connection end it while it is idle and wait before the next read (`server/core/storage/tests/abort.test.ts:390-398`, `server/core/storage/tests/db-adapter.test.ts:129-138`, which waits 300 ms "so the worker thread sees the closed sockets"). By then the socket `close` event has set `read.failed`, so `read_conn` opens a new connection, `opened_before` is false, and the retry branch does not run. With lines 427-433 replaced by a single `read_statement` call, both tests still pass, apart from a timing race. Removing the retry would not fail any test, so it is untested. | Add a PostgreSQL test. A `read_db` query waits for a table that `testing.hold_db` holds with `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE`. After `testing.until_blocked_by`, another session runs `pg_terminate_backend` on the waiting read backend and the holder is released. Expect the query to return its rows from a new backend pid, not throw. Also expect a read whose connection is newly opened and then ended to throw. | no | 80 |

## previous

none

## out of scope

- server/core/storage/tx.ts:201: medium A transaction function can let out a `lock` or `connection` DbError that did not come from a statement of its own transaction, for example a `read_db` query inside the function that waits past `storage.userLockWaitMs`. `read_db` statements run with `owner` null (`server/core/storage/core.ts:196-205`), so `mark_broken` never runs and `state.broken` stays false. `body` still returns `FAILED` through `is_db_failure(error)`. `open-game-works-core/skills/server-core/modules/storage.md:348` (error table: a throw of the function on a transaction that PostgreSQL did not abort rolls back and throws) and `open-game-works-core/skills/server-core/modules/storage.md:155` (a `read_db` statement failure throws) say the operation should roll back and throw that value. This line existed before the range.

## debt

none

## must fix

none

## unknown

- No tests were run. This checkout has no installed test runner, and no PostgreSQL server is available on this host. So the PostgreSQL-only tests in `server/core/storage/tests/abort.test.ts`, `game-state.test.ts`, `rows.test.ts`, `user-change.test.ts` and `db-adapter.test.ts` were checked by reading them, not by running them. R1-1 rests on reading `pg_protocol.ts`: a FATAL `ErrorResponse` is followed by a socket `close` that sets `failed` before `results()` throws, so `read.failed` is already true when the next read starts. It was not confirmed by restoring the defect and running the tests.
- Checked against the spec by reading only: whether `in_id_list` on PostgreSQL (`= ANY(CAST(string_to_array($n, ',') AS BIGINT[]))`) and on SQLite (`IN (SELECT value FROM json_each($n))`) hit the primary-key index for 70000 IDs. Query plans were not inspected.
- Core modules outside storage that catch a failed statement inside a transaction and go on now get `FAILED` from the new `body` rule. Those callers were not reviewed: they are outside this target.
