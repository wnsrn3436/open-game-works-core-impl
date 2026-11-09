# review guild round 1

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

- The commit range changes no file under server/core/guild/ and no guild spec (`## spec changes` is none). The dependencies of guild changed in the range are storage (server/core/storage/core.ts, index.ts, tx.ts, core-spec/storage.json: new `fail_transaction` and its `not_failed` check in `user_state_of` and `any_state_of`) and logging (server/core/logging/metrics.ts: a comment only). validation, server-time and public-profile have no change in the range.
- `not_failed` throws only on a transaction that `fail_transaction` marked. Guild never calls `fail_transaction`, calls no item-ledger operation (whose hook failures now call it), and has no `catch` in server/core/guild/, so a storage throw still ends a guild transaction as before. `lock_game_row`, `db`, `after_commit` and `on_commit` keep their behavior for an unmarked transaction. I found no change in guild behavior from these changes.
- `ogw core test server guild` (job mw8ljq958cde2a) failed 4 PostgreSQL tests: 3 with "cannot connect to PostgreSQL: the connect to PostgreSQL went over its time limit" in server/core/guild/tests/locks.test.ts and admin.test.ts, and 1 with "wait_background did not end within 10000 ms" in server/core/guild/tests/admin.test.ts (import_guild with a concurrent Withdraw). The host load average was about 21 at the time. Re-running server/core/guild/tests/locks.test.ts (job mw8lt2qv9bb6ff) and server/core/guild/tests/admin.test.ts (job mw8lt4df10b6eb) alone passed both files. I did not reproduce a cause in guild code for the first failures; I take them as host load on the PostgreSQL test server, which is not guild scope.
- Guild code outside the range and the places it calls was not reviewed again, per step 2 of the procedure.
