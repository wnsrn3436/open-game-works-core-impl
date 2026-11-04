# review item-ledger round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/item-ledger/history.ts:108 now takes `seq` as `COALESCE(MAX(seq), 0) + 1` over the user's rows with `expires_at > $18`, where `$18` is `clock_now` passed from server/core/item-ledger/ledger.ts:807-809, and writes with `ON CONFLICT (user_id, seq) DO UPDATE SET` every column outside the key (history.ts:92, the set is built from `HISTORY_COLUMNS` minus `user_id` and `seq`, so `expires_at` is overwritten too). Because the new seq is greater than every unexpired seq of the user, the conflict can only hit an expired row, so a live row is never overwritten; per-user serialization (storage `per-user serialization`) keeps two transactions of the same user from computing the same seq. The sweep delete (server/core/storage/rows.ts:375,377) re-checks the expiry condition, so a row the upsert just wrote over is not deleted by a sweep running at the same time. The new test server/core/item-ledger/tests/history.test.ts:61 checks seq 1 over the expired row, that only the new row is listed, that 3 rows are stored before and after (an upsert, not an insert), and that the sweep then keeps only the written-over row. With the old SQL, the stored rows have seq 1, 2 and 3, so `MAX(seq) + 1` gives 4 where the test expects 1, and the test fails (the core agent report says it ran that check). `ogw core test server item-ledger --file server/core/item-ledger/tests/history.test.ts` passes on SQLite and PostgreSQL at 3ff45b7 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: server/core/item-ledger/history.ts:108 counts only unexpired rows in `MAX(seq)` and writes over an expired row with the same key, so the seq after the retention no longer depends on when the sweep ran. server/core/item-ledger/tests/history.test.ts:61 checks this before the sweep, and history.test.ts:58 still checks it after the sweep |

## must fix

none

## unknown

- In the commit range, only server/core/item-ledger/history.ts, server/core/item-ledger/ledger.ts and server/core/item-ledger/tests/history.test.ts of the target changed. The dependencies storage, server-time and logging did not change. Other files in the range belong to other modules and were not reviewed
- The defect was not restored in a temporary copy: R1-1 is a `spec` finding, not a `test evidence` finding. That the new test fails on the old SQL was worked out from the stored seqs, together with the core agent report, and was not run again here
- Only the history test file was run (`--file`), not the full item-ledger suite or the modules that depend on it. The core agent report says those all passed on both DBs
- Cost of the new subquery: when the user's newest rows have expired but have not been swept, `MAX(seq)` with the `expires_at` filter reads past those rows. With `routing.storageSweepIntervalMs` 60000 and `item-ledger.historyRetentionMs` 7776000000 in core settings, those rows are only the ones that expired since the last sweep. So this is not written as an `efficiency` finding. The query plan on PostgreSQL was not measured
