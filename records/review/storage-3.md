# review storage round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | efficiency | medium | server/core/storage/rows.ts:137 | Debt D1, still present. `scan_users` with a version runs `SELECT u.user_id FROM "user" u WHERE u.user_id > $1 AND u.withdrawn_at IS NULL AND (EXISTS (... user_state s ... s.contract_version < $3) OR EXISTS (... server_state s ... s.contract_version < $3)) ORDER BY u.user_id LIMIT $2`. `user_state` and `server_state` have only the key `(user_id, kind, item_id)` (server/core/storage/schema.ts:212), and `CORE_SCHEMA` (schema.ts:231, `base_v1`, `base_v2`) adds no index on `contract_version`. So each visited `user` row costs a scan of that user's rows in both tables, and the query stops early only after `max` matches. The last step of every migration batch finds no user and visits every remaining `user` row above the cursor: the work of one call grows with the number of users and their rows. open-game-works-core/skills/server-core/modules/storage.md:305 says query functions are synchronous and a PostgreSQL answer later than `storage.dbAnswerWaitMs` after the lock wait limit aborts the statement. The duration on a large table was not measured. | Bound the work of one call, e.g. scan a bounded `user_id` range per call and return the next cursor, or keep the users with lower-version rows in an indexed form. | no | 85 |
| R3-2 | spec | medium | server/core/storage/tx.ts:201 | Debt D4, still present. `body` catches the throw of the transaction function, and `if (is_db_failure(error)) return 'FAILED'` (tx.ts:201) runs before the `state.broken` check. A `lock` or `connection` `DbError` that a `read_db` statement inside the function throws is not from a statement of that transaction: `DbHandle.query` with `owner` null (server/core/storage/core.ts:194-207) never calls `mark_broken`, so `state.broken` stays false, yet `run_user_transaction`, `run_request_transaction`, `run_rollback_transaction` and `run_game_transaction` return `FAILED`. Run path: on PostgreSQL, inside `run_game_transaction`, `storage.read_db().query(...)` on a row that a `testing.hold_db` session holds with `SELECT ... FOR UPDATE` waits past `storage.userLockWaitMs`, `pg_worker` reads with `lock_timeout` `read_wait_ms` and the statement fails with kind `lock`; the function lets it out and the operation is `FAILED`. open-game-works-core/skills/server-core/modules/storage.md:155 and open-game-works-core/skills/server-core/modules/storage.md:353 say that `read_db` statement throws, and open-game-works-core/skills/server-core/modules/storage.md:348 says a throw of the function on a transaction that PostgreSQL did not abort rolls back and throws. | Return `FAILED` only for a db failure of a statement of this transaction (e.g. `state.broken`, or the error is `state.broken_by`); otherwise roll back and throw. | no | 85 |
| R3-3 | spec | medium | server/core/storage/db/sqlite.ts:49 | Debt D5, still present. `param` refuses only a `string` that includes U+0000 (`NUL_IN_TEXT`); an unpaired surrogate passes to `node:sqlite`. open-game-works-core/skills/server-core/modules/storage.md:307 says a statement with a `string` parameter that holds U+0000 or an unpaired surrogate fails in both DBs. Reproduced with `node:sqlite` `DatabaseSync` (the driver sqlite.ts uses): `INSERT INTO t VALUES (?)` with `'\ud800'` succeeds and `SELECT v` returns `'�'`, so on SQLite such a statement commits and the stored text is changed to U+FFFD. | Make `param` throw the same `sql` `DbError` for a string that is not well-formed UTF-16 (`!value.isWellFormed()`), with a test in both DBs. | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R3-1 | `scan_users` (server/core/storage/rows.ts:130-141) and the state table keys (server/core/storage/schema.ts:212) are unchanged; no index on `contract_version` in `CORE_SCHEMA` (schema.ts:231). |
| D2 | fixed | none | server/core/storage/db/pg_worker.ts:302 now fails only when a connection wait happened (`waited !== null && wait_ms < 1`); with no wait, `wait_ms` is `lock_wait_ms` 0 and `timeouts` sets `lock_timeout` through `ms_limit` (pg_worker.ts:95-97, at least 1 ms), so PostgreSQL does not read it as "no limit". Test server/core/storage/tests/abort.test.ts:518-523 (`with storage.userLockWaitMs 0, a transaction that waits for nothing commits`) runs a request transaction and a game transaction with `storage.userLockWaitMs` 0. Changed in commit d469dc5. |
| D3 | fixed | none | `body` (server/core/storage/tx.ts:195-208) now returns `FAILED` after a return when `state.broken` (`if (!state.broken) return { value }; await rollback(core, state); return 'FAILED'`), before `run_user` (tx.ts:215) and `run_game` (tx.ts:263) look at a failure code. Commit 9e53845 adds the test `a function that catches it and returns a failure code, or ends a rollback transaction, is FAILED, not that value` in server/core/storage/tests/transaction.test.ts. |
| D4 | open | R3-2 | server/core/storage/tx.ts:201 still returns `FAILED` for any `is_db_failure` throw before the `state.broken` check, and server/core/storage/core.ts:204 marks only an owner transaction broken. |
| D5 | open | R3-3 | server/core/storage/db/sqlite.ts:49 checks only U+0000; reproduced with `node:sqlite` that a `'\ud800'` parameter is stored as U+FFFD. |

## must fix

none

## unknown

- The commit range is empty (`34e21ec..34e21ec`), so no code changed in this round; only the input debt items were checked.
- No storage test file was run. D2 and D3 were judged from the current code and the tests that commits d469dc5 and 9e53845 added; those tests were not run here and not checked against a restored defect (the debt items are not `test evidence` findings).
- R3-1: the duration of the `scan_users` query on a large PostgreSQL table was not measured.
- R3-2: the run path was traced through the code, not run against PostgreSQL. Whether a `read_db` `connection` failure inside a transaction function should be `FAILED` (open-game-works-core/skills/server-core/modules/storage.md:352) or a throw (open-game-works-core/skills/server-core/modules/storage.md:348, :353) is not clear from the spec; the finding stands on the `lock` kind, which open-game-works-core/skills/server-core/modules/storage.md:352 does not cover.
- R3-3: the PostgreSQL side of an unpaired surrogate parameter was not checked.
