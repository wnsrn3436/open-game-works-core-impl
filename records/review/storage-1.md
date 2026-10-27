# review storage round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | server/core/storage/rows.ts:392 | The table budget is `network_time_limit`, which aborts from a `setTimeout` callback (server/core/server-time/network_time_limit.ts:13). On SQLite, `SqliteAdapter.autocommit` (server/core/storage/db/sqlite.ts:275) only awaits promises that are already resolved when there is no contention: `Mutex.lock` returns `Promise.resolve().then(...)` (sqlite.ts:72), `try_begin` succeeds at once, and `conn.run` is synchronous. So the `for (;;)` loop at rows.ts:396-400 never yields to the timer phase, `budget.aborted` stays false, and the loop runs until a statement deletes fewer than `storage.sweepBatchSize` rows. This breaks storage.md:267 (statements stop once `storage.sweepTableBudgetMs` has passed since the first statement of that table), and the whole server instance is blocked while it runs. Reproduced on SQLite in a temporary copy of the checkout: a table with 20000 expired rows, `storage.sweepBatchSize` 1, `storage.sweepTableBudgetMs` 1. One `sweep_expired` returned `deleted` 20000 after 1417 ms, and a `setTimeout(…, 0)` set just before the call had not fired when it returned | Check the budget against real elapsed time measured directly (e.g. `performance.now()` taken before the first statement of the table, compared after each statement) and not against a timer flag. Add a SQLite test with many expired rows, a small batch size and a 1 ms budget: one run should delete fewer than all the rows, and the next run should delete the rest | no | 95 |
| R1-2 | test evidence | medium | server/core/storage/tests/expiry.test.ts:69 | No test fails when either part of the batch definition at storage.md:267 is removed. In a temporary copy, the statement limit was raised to `BigInt(batch) * 1000000n` (so one statement deletes every expired row) and `\|\| budget.aborted` was dropped at rows.ts:399. expiry.test.ts, rows.test.ts, db-adapter.test.ts and game-state.test.ts still all passed on SQLite (32 passed). The batch test only checks the total of 5, and a single unbounded delete also gives that total. No test sets `storage.sweepTableBudgetMs` (a grep of server/core finds it only in testing/dev/setting_types.ts). The PostgreSQL-only sweep tests use 1 or 2 rows per table, so they test neither bound | Add a test that one statement deletes at most `storage.sweepBatchSize` rows. For example, with batch size 2 and 5 expired rows, plus a budget that ends after the first statement, one run deletes 2 and leaves 3, or the DB statement count/changes are observed. Add a test that the table budget stops further statements of that table (see R1-1) | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the PostgreSQL-only tests of the range (no `OGW_POSTGRESQL` in this review run). I checked the PostgreSQL behavior by reading the code only: the `ctid` batch delete (rows.ts:375), the `POOL` code mapped to the empty DB error code (rows.ts:364 with pg_messages.ts:53), and that `autocommit` resolves through the worker message port, so the timer of R1-1 can fire there.
- I did not check `CREATE INDEX IF NOT EXISTS` (schema.ts:202) against an operator-made index of the same name that PostgreSQL left `INVALID` after a failed `CREATE INDEX CONCURRENTLY`.
- The routing side of the change (routing_module.ts `storage_sweep` per-table error log) is checked only as the caller of `sweep_expired`. The routing spec is not among the defining documents of this review.
