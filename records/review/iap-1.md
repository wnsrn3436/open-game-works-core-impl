# review iap round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | server/core/iap/adapters/apple.ts:163 | `roots()` returns `'rejected'` when the key source value is not a list of root certificates (`roots_of(value) ?? 'rejected'`). `signed` passes it on (line 169), `signed_notification` returns it (line 224), `refunds_of` returns it for the whole page (line 243), so `list_refunds` returns `rejected`. The spec (`### refund lookup`, `iap-apple` bullet, and `## settings` "a failure of that call or a value that is not a list of root certificates is an adapter call failure") makes this an adapter call failure, and only HTTP 400 is `rejected`. Reproduced: `create_apple_adapter({..., key_source: () => Promise.resolve('not a list')}).list_refunds(1n, 2n, 'P1', call)` with a 200 answer that has one `notificationHistory` element returns `rejected`. In `server/core/iap/refund_lookup.ts:173` a `rejected` with page token `P1` writes the cursor row with the empty page token and `done` `false`, so the next run reads the window from the first page instead of keeping the cursor row and reading page `P1` again (error table row "failure or time limit exceeded of `list_refunds` ... the cursor row stays"). The Google adapter already maps its own `rejected` access token to `communication_failure` (google.ts:380); the Apple path has no such mapping | Return `communication_failure` (an adapter call failure) for a key source value that is not a list of root certificates, at least on the `list_refunds` path (e.g. map a `rejected` from `refunds_of` to `communication_failure`, or make `roots()` return `communication_failure`), and add an adapters test with a key source that returns a non-list value and a page token | no | 90 |
| R1-2 | spec | medium | server/core/iap/tests/refund-lookup.test.ts:87 | The `## error` table of the iap spec sets these refund lookup failure behaviors, and no test goes through them (no test anywhere under `server/core` makes a write to `iap_refund_cursor` or `iap_refund_retry` `FAILED`, or makes a `read_db` read in job `iap_refund_lookup` throw; the messages `could not write iap_refund_cursor`, `could not write iap_refund_retry`, `could not read iap_refund_retry`, `could not read iap_refund_cursor` of refund_lookup.ts:109,125,161,174,184,190 appear in no test): (1) a `FAILED` insert into `iap_refund_retry` or a `FAILED` cursor write of a page ends that store without writing the cursor row, and the next run reads that page again; (2) a `FAILED` write of `iap_refund_retry` in the retry ends the retry of that store, a row whose give-up delete was `FAILED` stays and no give-up log is left; (3) a throwing `read_db` of the retry rows ends the retry but the pages are read; (4) a throwing `read_db` of the cursor row ends that store. Path (1) is what keeps a refund from being lost when its refund apply failed and its retry row could not be written, and a change that writes the cursor row after a failed insert would pass every current test | Add tests that make those writes `FAILED` (e.g. a storage fault or a wrapped `run_game_transaction`) and those reads throw, and check the cursor row, the retry rows, the next run's `list_refunds` call and the `error` logs | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The whole test suite and the iap tests were not run: the review checkout has no installed test runner (`server/` has no `node_modules`). R1-1 was reproduced with a standalone script that imports `server/core/iap/adapters/apple.ts` under `node --experimental-strip-types`.
- Whether the concurrency test `refund apply of the lookup and a REFUND notification of the same GRANTED store transaction at once ...` (refund-lookup.test.ts:327) actually makes the two runs overlap (it uses no `hold`, so the job can finish before the notification reads the payment record) was not checked by restoring a defect, because the tests could not be run here.
- PostgreSQL behavior of the new refund lookup statements (`ORDER BY failed_at, transaction_id` collation, boolean binding of `done`) was not run; only the SQLite path is exercised by the tests read.
- The settings constraint `iap.refundLookupIntervalMs` × 2 ≤ `iap.refundLookupBackMs` is evaluated by `ogw game check` from a constraints file that is not in this checkout; only the default values (3600000 × 2 ≤ 2160000000) were checked.
- The real Apple and Google refund list endpoints were not called; the request shapes were checked only against the spec text and the adapter tests.
