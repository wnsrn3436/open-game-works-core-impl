# review idempotency round 1

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

- The only change to the target in the range is `server/core/idempotency/tests/request-id.test.ts:168`, which follows the new `sweep_expired` result `{ deleted, failed }`. The test still checks that the expired row is gone (`rows(s, ROW, [user, 'req-x'])` is empty) and that the handler is called again. The storage changes that the target uses were checked against the idempotency rules: the batched delete `server/core/storage/rows.ts:375` keeps the outer `expires_at <= $1` condition, so a row that `save_response`, `save_withdrawn_response` or `claim_notify` rewrote by upsert over an expired row is not deleted. The expiry-column index that `register_table` now adds (`server/core/storage/schema.ts:191`) goes on the three idempotency tables, and `apply_schema` creates it on existing tables (`server/core/storage/schema.ts:310`). No defect was found
- Only the SQLite runs were done (`core/idempotency` and `core/storage/tests/expiry.test.ts`: 27 passed). PostgreSQL runs were not done because no PostgreSQL was given, so the 2 PostgreSQL-only tests of `core/storage/tests/expiry.test.ts` were skipped. The PostgreSQL behavior of the batched `ctid` delete running at the same time as an upsert on the same idempotency row was checked by reading the code (the outer expiry condition is rechecked on the updated row version), not by a run
- Code of the target outside the range (all of `server/core/idempotency/index.ts` and the other test files) was read to trace callers, but not reviewed for findings, because only problems that the range causes or reveals are in scope
