# review storage round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `scan_users` with a version now calls `users_below` (server/core/storage/rows.ts:146): `versions_below` (rows.ts:170) finds the distinct `contract_version` values below v with one `ORDER BY contract_version LIMIT 1` step each, then per (table, version) `SELECT DISTINCT user_id ... WHERE contract_version = $1 AND user_id > $2 ORDER BY user_id LIMIT $3`, then one `user` read by primary key of at most `want` candidates for the withdrawn filter. Core schema version 3 (server/core/storage/schema.ts:234 `base_v3`, `CORE_SCHEMA_VERSION` 3, server/core/storage/core-schema-version 3) adds `(contract_version, user_id)` indexes to `user_state` and `server_state`, so each step is an index range. The union of each source's first `want` users holds the first `want` users of all sources, so the paging is exact (traced; test server/core/storage/tests/rows.test.ts:344 pages with max 1, 2, 3, 10 over two versions, both tables and a withdrawn user). A call with no lower-version row reads no `user` row (rows.test.ts:392). Loop iterations beyond the first need withdrawn candidates, and `delete_user` deletes a withdrawn user's `user_state` and `server_state` rows (open-game-works-core/skills/server-core/modules/storage.md:254), so the work of one call follows `max` and the number of versions below v, not the number of users. |
| R3-2 | fixed | `body` (server/core/storage/tx.ts:202) now returns `FAILED` only when `state.broken` (`state.broken && (error !== state.broken_by \|\| is_db_failure(error))`); otherwise it rolls back and throws. A `read_db` statement (`DbHandle` with `owner` null, server/core/storage/core.ts:194-207) never marks the transaction broken, so its `lock` or `connection` failure let out of the function is thrown, as open-game-works-core/skills/server-core/modules/storage.md:155, :348 and :353 say. Every statement of a transaction still marks it broken: `q` (core.ts:288-296), `DbHandle.query` with an owner (core.ts:204), `lock_row` (tx.ts:398-404); `locked_row` (server/core/storage/user_change.ts:93) throws its own `DbError` only after `lock_row` returned `FAILED`, so the transaction is broken and the result stays `FAILED`. Test server/core/storage/tests/abort.test.ts:425 covers all four transaction operations, letting out and catching the `read_db` throw. |
| R3-3 | fixed | `check_text_param` (server/core/storage/db/types.ts:99) throws the `sql` `DbError` for a `string` with U+0000 or that is not well-formed UTF-16. SQLite `param` (server/core/storage/db/sqlite.ts:44-47) runs it for every `query`, `run` and `begin` first statement parameter, and PostgreSQL `params_of` (server/core/storage/db/postgres.ts:32-34) for transaction statements (postgres.ts:222), `read_db` statements (postgres.ts:305), autocommit statements (postgres.ts:324) and the first statement of `begin` (postgres.ts:337). A failure in a transaction statement goes through `q` or `DbHandle.query`, so it marks the transaction broken like a DB-side failure. Test server/core/storage/tests/abort.test.ts:575 runs the U+0000 case and `'a\ud800b'` in both DBs. |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R3-1: server/core/storage/rows.ts:146 and :170 walk the `(contract_version, user_id)` indexes of server/core/storage/schema.ts:234; the step that finds no user reads no `user` row. |
| D4 | fixed | none | Same as R3-2: server/core/storage/tx.ts:202 returns `FAILED` only for a transaction broken by its own statement; a `read_db` failure let out of the function rolls back and throws. |
| D5 | fixed | none | Same as R3-3: server/core/storage/db/types.ts:99 refuses an unpaired surrogate, called from server/core/storage/db/sqlite.ts:46 and server/core/storage/db/postgres.ts:33. |

## must fix

none

## unknown

- Ran `ogw core test server storage --file server/core/storage/tests/rows.test.ts` and `--file server/core/storage/tests/abort.test.ts`: both pass (two pass lines each). Other storage test files and the test files of dependent modules changed in this range (server/core/push/tests/helpers.ts, server/core/auth/tests/transaction-failure.test.ts, server/core/ads-reward/tests/callback.test.ts) were not run here; `ogw review run` runs the dependents after a fix.
- The fixes were not checked against a restored defect: none of R3-1, R3-2, R3-3 is a `test evidence` finding.
- R3-1: the query plans and the duration of `scan_users` and of creating the two version 3 indexes on a large PostgreSQL table were not measured; that each step uses the index comes from the index shape and the query form.
- R3-2: only the `lock` kind of a `read_db` failure inside a transaction function is covered by a test; the `connection` kind takes the same code path (it does not set `state.broken`) but was not run. The error table row "DB connection failure" (open-game-works-core/skills/server-core/modules/storage.md:352) does not say that it covers only statements of that transaction; open-game-works-core/skills/server-core/modules/storage.md:152 limits it to statements of an open transaction, and the code follows that.
- The changes in this range to modules other than storage (admin-api, mailbox, matchmaker, coupon, RealtimeCore, VirtualPadCore) are outside this target and were not reviewed.
