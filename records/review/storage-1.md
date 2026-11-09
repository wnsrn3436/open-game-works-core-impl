# review storage round 1

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

- Only the storage changes of the range were reviewed: `fail_transaction` (`server/core/storage/tx.ts`, `server/core/storage/core.ts` `not_failed` in `user_state_of` and `any_state_of`, `server/core/storage/index.ts`), the code they reach (`body`, `run_user`, `run_game`, `run_savepoint`, `commit`, `DbHandle.query`, `q`, `lock_row`, `lock_game_row_content`) and `server/core/storage/tests/fail-transaction.test.ts`. Every storage operation that takes a ctx or game tx was checked by reading to go through `user_state_of` or `any_state_of`, or through a `DbHandle` whose `query` throws on `broken`. The callers of `fail_transaction` outside storage (`server/core/item-ledger/ledger.ts:448`) were not reviewed
- `ogw core test server storage --file server/core/storage/tests/fail-transaction.test.ts` ran and passed. It ran on SQLite only (this run has no `OGW_POSTGRESQL`); the PostgreSQL path of `fail_transaction` (rollback of an open PostgreSQL transaction that was marked without a failed statement) was checked by reading the code only
- The whole storage test suite was not run
