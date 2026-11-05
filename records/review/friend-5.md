# review friend round 5

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

- In the range, friend changes only server/core/friend/tests/lock-timeout.test.ts (`while_held` now expects, on PostgreSQL, exactly one added `error` line `request transaction failed` of `routing` with the request name, also for `core/Withdraw`). This follows the storage change of the range (commits 9e53845, d469dc5) under which a lock wait timeout of `lock_game_row` aborts the PostgreSQL transaction and the operation that opened it is `FAILED` whatever the function returns or throws. Checked against server/core/friend/index.ts:254 (core rpc and block listener throw on `FAILED`), :395 (`remove_user` returns `FAILED`), server/core/auth/account.ts:75-80 (`Withdraw` gives `INTERNAL` with no own `error` line on `FAILED`) and server/core/routing/pipeline.ts:702 (the `routing` line). The result matches the friend spec `## error` rows for a lock wait in a core rpc, in `remove_user` and in the block listener
- Of the spec changes, the storage changes (`get_states` caller, `run_user_changes` throw, the `lock_game_row` key text and its removed test) and the logging changes do not reach friend code: friend uses only `register_table`, `lock_game_row`, `db` and `get_state` of storage (server/core/friend/index.ts:228) and calls no logging operation. The storage code of the range itself (tx.ts, core.ts, pg_worker.ts, user_change.ts) was read only for how a `lock_game_row` `FAILED` ends the transaction; the rest belongs to the storage review
- `ogw core test server friend` passes on SQLite and PostgreSQL on this checkout. The whole server test suite was not run
- The `while_held` cases run a real lock holder (`testing.hold_game_row_lock`) on PostgreSQL; a real concurrent interleaving for step 3 of `remove_user` (`CHANGED`) was not run, as in round 4
