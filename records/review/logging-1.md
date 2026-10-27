# review logging round 1

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

- No file under `server/core/logging/` changed in the range `cf89b7fd2768ede33b78f5948fb0fae06df506e2..bf6232cef27a94e8c84b7a7d86620fcde8afd8d6`. The changes that reach logging are the ones in `storage` (batched `sweep_expired` with the failed table list, the expiry column index that `register_table` adds, `NO_FREE_CONNECTION` `'POOL'` in `LOCK_CODES`) and in the `routing` job `storage_sweep`. Checked against logging:
  - `server/core/logging/tables.ts:67-72`: the three log tables and `logging_report_counter` have the expiry column `expires_at`, and none of their index lists starts with it. So `register_table` now adds an `(expires_at)` index to each one. That is the rule of storage.md `## behavior` (index list), and it does not conflict with the `(time_at, user_id, seq)` index that logging.md writes
  - `server/core/storage/rows.ts` `sweep_sql`: the outer expiry condition keeps a `logging_report_counter` row that the upsert `UPSERT_REPORT_COUNTER` (`server/core/logging/tables.ts:92`) rewrote with a new `expires_at` after the inner select. `list_rows` (`server/core/logging/tables.ts:128`) still filters `expires_at > now`, so a row left by a sweep cut short by its budget or a failure counts as absent, as storage.md requires
  - Logging does not read the return value of `sweep_expired` or the DB error codes. Its tests call `sweep_expired()` without using the result (`server/core/logging/tests/client-log.test.ts:340`, `server/core/logging/tests/server-event.test.ts:195`)
- Ran with `ogw core test server logging --file`: `server/core/logging/tests/client-log.test.ts` and `server/core/logging/tests/server-event.test.ts` (both pass) on the default DB kind of the test helpers. Did not run the other logging test files or the PostgreSQL run of these files. The lead agent runs the full core tests
- Did not review logging code outside the paths the range reaches, because the commit range is not `none`
