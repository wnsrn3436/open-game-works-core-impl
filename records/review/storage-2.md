# review storage round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | The range adds three PostgreSQL tests to `server/core/storage/tests/abort.test.ts:445-492`. They make PostgreSQL end a `read_db` statement while it waits on `LOCK TABLE test_counter IN ACCESS EXCLUSIVE MODE` that `testing.hold_db` holds: `end_reads` (`abort.test.ts:113-136`) waits until a session is blocked by the holder, then runs `pg_terminate_backend` on it. No other retry path exists on the main thread: `server/core/storage/db/postgres.ts:104-122` `call_sync` and `server/core/storage/core.ts:194-207` `query` pass the worker's answer on. Defect restored in a detached temporary worktree of `29202ee` under `worktrees/_core/`, outside this checkout. (1) `server/core/storage/db/pg_worker.ts:432-433` replaced by `throw error`, so the error is always thrown with no retry: `ogw core test server storage --file server/core/storage/tests/abort.test.ts` failed `a read_db query waiting for a table that testing.hold_db holds, whose read session another session ends with pg_terminate_backend, runs once more on a new connection and returns its rows` with `Error: the server closed the connection`. (2) The `opened_before` guard removed (`if (!connection_ended(error)) throw error;`): the same run failed `a read_db query on a read connection opened for it, because the one before was ended, throws when PostgreSQL ends that new connection ...` with `expected null to be an instance of Error`. The same file passed on unmodified `29202ee`. |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `server/core/storage/tests/abort.test.ts` was run, on PostgreSQL through `ogw core test`: once with each restored defect, and once unmodified. The other storage test files and the SQLite run were not run. The range changes no storage code, only this test file.
- The third new test (`abort.test.ts:476-492`) waits 300 ms so the worker thread sees the idle read socket close. If the close arrived later, the test would still pass on correct code but would not catch a missing `opened_before` guard. In the restored-defect run it did catch it. How often the close arrives later was not measured.
- The other changes in the range (guild, InputCore, QACore, data tool, review records) are outside this target and were not reviewed. Debt item D4 of `records/review-debt/storage.json` (round 1 out of scope) predates the range and the range does not touch it, so it was not checked again.
