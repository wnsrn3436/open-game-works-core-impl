# review reset-counter round 1

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

- The commit range 625ae189..edae04df changes no file under `server/core/reset-counter/`, `server/core/server-time/`, `server/core/testing/`, `core-spec/reset-counter.json` or `test-data/data/tables/reset_counter.csv`. The only change that reaches reset-counter is `storage` `fail_transaction` (`server/core/storage/tx.ts:373`, `server/core/storage/core.ts:268`): after it marks a transaction, `user_state_of` and `any_state_of` throw a `DbError` that is not a `StorageMisuse`, so `get_state` and `put_core_state`, the only `storage` operations reset-counter calls (`server/core/reset-counter/index.ts:11`), throw too. reset-counter catches no error from them (`server/core/reset-counter/index.ts:80`, `server/core/reset-counter/index.ts:94`), so the throw reaches the `storage` body, which ends the transaction as `FAILED` (`server/core/storage/tx.ts:225`). This causes no reset-counter finding. How `routing` answers and logs that `FAILED` belongs to `storage` and `routing` and was not reviewed here
- `ogw core test server reset-counter` passed on this checkout on its second run. On the first run, two PostgreSQL tests (`server/core/reset-counter/tests/cheat.test.ts` "is INVALID_REQUEST for an unknown reset counter ...", `server/core/reset-counter/tests/count.test.ts` "judges with a limit argument over the row limit ...") failed with `storage: cannot connect to PostgreSQL: the connect to PostgreSQL went over its time limit`, before any reset-counter code ran. This did not happen again on the second run. Its cause (probably load from other test runs on the host) was not reproduced or checked
- No reset-counter test calls `fail_transaction` before `add_count` or `get_count`. The spec of reset-counter does not set that case, and `storage`'s own tests cover it (`server/core/storage/tests/fail-transaction.test.ts`)
- The data check `out_of_range` for a row `limit` of 0 is tested in `tools/data-tool/tests/reset-counter-checks.test.ts`, outside this target, and was not reviewed
- Client `UserStateCore.get_reset_counter`, which reads the count by the same rules, is a client module outside this target and was not read
