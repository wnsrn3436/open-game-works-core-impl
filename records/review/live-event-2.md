# review: live-event round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/live-event/index.ts:274-285: `settlement_change` returns `true` after the `live event settlement transaction failed` log on `FAILED` and after the `live event settlement threw` log, and `false` only for `WITHDRAWN`, so `on_request_start` (index.ts:376-385) goes on to the next due participation. In `first`, `due` is assigned before `settle_entry` runs, so a `FAILED` first change still leaves the list for the later changes. Test server/core/live-event/tests/settlement.test.ts:108 breaks the transaction of the lower event ID with `SELECT * FROM no_such_table` and asserts that the hook is called for both IDs in one `core/Resync`, that only the higher entry is settled in that response and in saved state, and that the next `core/Resync` settles the lower entry. `ogw core test server live-event` passes on this checkout |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not restore the defect in a temporary copy to watch the new test fail. R1-1 is a `spec` finding, so step 5 does not require it. The core agent report says the test fails without the fix in both the SQLite and the PostgreSQL run
- The case where `storage.run_user_transaction` of the first settlement change throws or is `FAILED` before its body runs (e.g. the DB is unreachable, or the wait passes `storage.userLockWaitMs`) leaves `due` empty, so no participation is settled in that request. The next request does them again. No test makes this case happen, and I did not run it
- The other changes in the range are review records and `records/review-debt/admin-api.json`, outside this target. I did not review them
