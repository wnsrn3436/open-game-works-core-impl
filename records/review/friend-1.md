# review: friend round 1

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

- `server/core/friend/` has no change in the commit range 625ae189..aca0d897. Checked the changes of that range that the friend code reaches: `server/core/storage/core.ts`, `server/core/storage/tx.ts`, `server/core/storage/index.ts` (`fail_transaction`, the `failed` check in `user_state_of`/`any_state_of`, the `failed` rule in `body`). friend never calls `fail_transaction`, so the new check only acts when content code inside `on_friend_changed` marks the transaction, and then the friend rpc ends as `FAILED` → `INTERNAL` with nothing written, which matches the friend spec. The `session.end_session` change (`server/core/session/index.ts`) and the `logging` metrics change are not called by friend. No change in the range touches `block-report`, `public-profile` or `nickname` code that friend calls (`server/core/nickname/tests/admin.test.ts` changed tests only)
- The new storage rule that a core module calls `fail_transaction` when a failure of its own must not be committed whatever the caller catches does not apply to friend: its core rpcs and the block listener are called only by `routing` and `block-report` (`server/core/block-report/index.ts:427`), which content cannot catch, and the failures of `remove_user` are returned to `auth`, which rolls back by the friend spec
- Core test of friend: the result is not known. `ogw core test server friend` ran twice (jobs mw8k7oejf4b619, mw8kzf9h7df112). Both failed only in the PostgreSQL run, with different tests each time, all with time limit errors (`the connect to PostgreSQL went over its time limit`, `Test timed out in 60000ms`, `wait_background did not end within 10000 ms`, a `DevLogin` rate counter transaction failure). The host load average was 23 to 36 during the runs. No SQLite failure line was printed. The cause was not reproduced on an idle host, so these runs are treated as environment failures and not as findings
