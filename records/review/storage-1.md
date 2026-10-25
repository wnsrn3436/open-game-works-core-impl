# review storage round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | server/core/storage/schema.ts:323 | The spec (storage.md `### base table`, server start fill) says the fill update "picks again on a conflict of `public_code`". `fill_public_codes` detects a conflict only with `NOT EXISTS (SELECT 1 FROM "user" WHERE public_code = $1)` in the same statement. On PostgreSQL (READ COMMITTED) that subquery does not see a row that another transaction has inserted but not yet committed. `create_user` of an already running server instance does not take the schema lock (rows.ts:62, `INSERT ... ON CONFLICT DO NOTHING`), so it can run during the fill. Run path: a DB has a `user` row with null `public_code` (made by a server of an earlier core version, which spec line 252 allows). Instance A is serving, instance B starts. A's `create_user` inserts code X and has not committed. B's fill picks X: the `NOT EXISTS` passes, the unique index `ix_user_public_code` waits for A's transaction, and when A commits the UPDATE raises a unique violation (23505). The schema transaction then aborts and B's server start fails, where the spec says it should pick again. On SQLite this cannot happen because `BEGIN IMMEDIATE` serializes writers. No test covers a conflict that is not yet committed (create-user-conflict.test.ts:67 only covers a committed taken code). | Run each fill UPDATE inside a savepoint. On a unique violation, roll back to the savepoint and pick again. Add a PostgreSQL test in which a lock holder inserts the picked code uncommitted, commits it while the fill waits, and the start still succeeds with another code | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- I ran the storage tests only on SQLite: tests/public-code.test.ts and tests/create-user-conflict.test.ts, 8 passed. I did not run the PostgreSQL runs or the other storage test files. So the PostgreSQL behavior of the new statements is checked only by reading the code: `INSERT ... ON CONFLICT DO NOTHING RETURNING`, the fill UPDATE with `$1` used twice, and `ALTER TABLE "user" ADD COLUMN` followed by `CREATE UNIQUE INDEX` on an existing version 1 DB
- I read the callers of the changed storage API in other modules only to confirm how they use it, and did not review them: auth/login.ts, auth/admin.ts, auth/deletion.ts, public-profile/index.ts. The test changes of other modules in the range (`new_user` and user ID order adjustments) are outside the storage target and were not reviewed
- Whether `pick_user_id` and `pick_public_code` are secure random was checked only by reading the code (`node:crypto` `randomBytes`). Tests cannot check it
- Speed of the server start fill on a large version 1 `user` table. Each batch re-reads the null rows and the whole fill runs in one schema lock transaction. This runs only at server start, not per request or per frame, so it is not an `efficiency` finding, and I did not measure it
