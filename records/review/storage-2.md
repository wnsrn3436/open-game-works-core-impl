# review storage round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/storage/rows.ts:404-408: after a delete statement that deleted `storage.sweepBatchSize` rows, `sweep_expired` awaits `next_turn` (rows.ts:381, `setImmediate`) before it reads `budget.aborted`. A `setImmediate` callback queued during the check phase runs in the next event loop iteration, so the timers phase, where the `setTimeout` of `network_time_limit` (server/core/server-time/network_time_limit.ts:13) fires, runs between two statements of one table. The budget is still created once per table before its first statement (rows.ts:397), as storage.md:267 sets, and it is still measured only with `network_time_limit`, as server-time.md:89 requires. Checked on SQLite in a temporary copy of the checkout outside the target checkout: with the current code, the test `with storage.sweepBatchSize 1 and storage.sweepTableBudgetMs 1, one sweep_expired deletes fewer than the 2000 expired rows of a table, and later runs delete the rest` (server/core/storage/tests/expiry.test.ts:107) passed 6 times in 6 runs. With `await next_turn();` removed (the R1-1 defect restored), it failed with `expected 2000 to be less than 2000`: one run deleted every row |
| R1-2 | fixed | New tests server/core/storage/tests/expiry.test.ts:92 (batch size 2, a budget mocked to a signal that has already aborted for the sentinel value at expiry.test.ts:22, 5 + 3 expired rows in two tables, runs delete 4, 3, 1) and expiry.test.ts:107 (real timer, batch size 1, budget 1 ms). Defects restored each in its own temporary copy outside the target checkout, then expiry.test.ts run on SQLite: (a) statement limit raised to `BigInt(batch) * 1000000n` at rows.ts:402: expiry.test.ts:92 failed with `expected { deleted: 8, failed: [] } to deeply equal { deleted: 4, failed: [] }` and expiry.test.ts:107 with `expected 2000 to be less than 2000`; (b) `if (budget.aborted) break;` removed at rows.ts:408: both tests failed with the same two messages. On the unmodified copy all 6 SQLite tests of expiry.test.ts passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I ran the tests on SQLite only (no `OGW_POSTGRESQL` in this review run), so the PostgreSQL run of the new tests and the PostgreSQL-only sweep tests were not run. The core agent report says `ogw core test server` over storage and its dependents passed on SQLite and PostgreSQL. I ran the whole server/core/storage/tests folder on SQLite on the unmodified copy: 119 passed, 30 skipped, and the only 2 failures were the PostgreSQL tests of concurrency.test.ts, which stop with `DB kind postgresql needs OGW_POSTGRESQL`
- server-core SKILL.md:32 says that in core code outside `tests/` the only files that use timers are `scheduler.ts` and `network_time_limit.ts`. rows.ts:382 now calls `setImmediate`, which Node keeps in its timers API but which takes no delay. The defining documents do not settle whether that rule covers `setImmediate`, and the static check named there (`TIMER_CALLS` in the harness tool) does not list it. So I did not write it as a finding. The core agent report raises it as a spec proposal for the lead agent
- expiry.test.ts:107 depends on 2000 one-row delete statements on SQLite taking more than 1 ms in total. On this host the run took about 90 ms; I did not measure the margin on slower or faster hosts
- I did not measure how much the per-statement `setImmediate` yield slows a long sweep under load
- The other changes in the range (client/godot QACore test, routing storage-sweep.test.ts, records) are outside the storage target and were not reviewed, except that routing's test only mocks `sweep_expired` and `run_user_changes` and does not touch server/core/storage
