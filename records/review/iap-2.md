# review iap round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/iap/adapters/apple.ts:160 now returns `roots_of(value) ?? 'communication_failure'`, so a key source value that is not a list of root certificates is an adapter call failure on every path through `signed()` (receipt verification, status lookup, store notification, `refunds_of`/`list_refunds`), as `## settings` of the iap spec sets. The other callers (calls.ts:15, notify.ts:58) treat every adapter failure the same, so only refund_lookup.ts:173 sees a difference, and it now keeps the cursor row. Test server/core/iap/tests/adapters.test.ts:372 checks `list_refunds` with `P1` and the empty token, and `verify`, for five non-list values. Restored the defect (`?? 'rejected'`) in a temporary `git worktree add` copy and ran `ogw core test server iap`: that test failed on SQLite and PostgreSQL with `expected 'rejected' to be 'communication_failure'` |
| R1-2 | fixed | server/core/iap/tests/refund-lookup.test.ts:264,300,321,355,371,390 now go through each `## error` row the finding named: a `FAILED` retry insert of a page, a `FAILED` cursor write of a page, a `FAILED` give-up delete, a `FAILED` `attempts` update, a throwing `read_db` of the retry rows, and a throwing `read_db` of the cursor row. Each test checks the cursor row, the retry rows, the `list_refunds` calls of this run and the next one, and the `error` logs. `ogw core test server iap --file server/core/iap/tests/refund-lookup.test.ts` passes on the review checkout. In a temporary worktree I restored these defects in refund_lookup.ts, and the targeted test failed on SQLite and PostgreSQL each time: (a) `continue` instead of `return` after a failed retry write failed :321 with 2 logs instead of 1; (b) rethrowing the retry `read_db` error so the pages are skipped failed :371 with `expected 'GRANTED' to be 'REFUNDED'`; (c) going on with `cursor = null` after a throwing cursor read failed the cursor-read test with 2 APPLE `list_refunds` calls instead of 1; (d) going on to the next page after a failed cursor write failed :300 with 2 logs instead of 1. The fix report also shows that :264 fails when the `return` after a failed retry insert is removed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only the iap core tests were run (`ogw core test server iap`, SQLite and PostgreSQL). The tests of modules that depend on iap were not run here; per `## aspects`, `ogw review run` runs them after each fix.
- The storage fault in the new tests swaps `run_game_transaction`, `db` and `read_db` on the storage module object. It does not make a real commit failure or lock timeout. A real `FAILED` goes through the same `result !== 'FAILED'` branch of `write()` in refund_lookup.ts, but that was not reproduced with a real DB fault.
- With the defect `continue` instead of `return` after a failed retry write, the `FAILED` `attempts` update test (refund-lookup.test.ts:355) still passes, because it has only one retry row. The "ends the retry of that store" behavior is covered by the give-up delete test (:321).
- Round 1 `## unknown` items outside the findings were not checked again: whether the concurrency test at refund-lookup.test.ts:327 really overlaps, the real Apple and Google refund list endpoints, and the settings constraint `iap.refundLookupIntervalMs` × 2 ≤ `iap.refundLookupBackMs` under game overrides.
