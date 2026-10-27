# review mailbox round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Tests were not run: the checkout has no `node_modules`, and `node --test` with `OGW_DEFAULT_DB=sqlite` stops at `ReferenceError: beforeEach is not defined` (the test globals come from the core test runner of `ogw core test`). The range changes were checked only by reading
- The range changes no mailbox source file. The only mailbox change is server/core/mailbox/tests/broadcast.test.ts:123, which follows the new `sweep_expired` result `{ deleted, failed }` (server/core/storage/rows.ts:385) and asserts `failed` is empty before checking that the expired broadcast row is gone. No other mailbox code calls `sweep_expired`
- Range changes that mailbox reaches were checked: `sweep_expired` batch deletes (server/core/storage/rows.ts:372) delete a `mailbox_broadcast` row only when `expires_at` ≤ the sweep time, which matches the reads that already treat such a row as missing (server/core/mailbox/tables.ts:172 and the list query after it); `mailbox_broadcast` is only inserted and its `cancelled` updated, so the outer expiry condition of the batch delete does not change its result. `with_expiry_index` (server/core/storage/schema.ts:191) adds an `expires_at` index to `mailbox_broadcast` (server/core/mailbox/tables.ts:40 declares no index), and `apply_schema` creates a new index on an existing table (server/core/storage/schema.ts:310), so an existing DB keeps starting. The new settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs` are in settings/core-settings.json, which the mailbox test server reads through `core_settings()` (server/core/mailbox/tests/helpers.ts:81)
- The storage sweep implementation itself (batch SQL per dialect, time budget, failed table list) and the routing `storage_sweep` error logs are outside the mailbox target and were not reviewed beyond their effect on mailbox
- Mailbox code that the range does not reach was not re-reviewed for problems that existed before the range
