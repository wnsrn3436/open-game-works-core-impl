# review storage round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/storage/schema.ts:324 `fill_update`: on PostgreSQL each fill UPDATE runs inside `SAVEPOINT fill_public_code`. A `DbError` with code `23505` (the PostgreSQL adapter keeps the SQLSTATE in `code`, server/core/storage/db/postgres.ts:21-25) rolls back to the savepoint and returns null, and `fill_public_codes` (schema.ts:351) then picks again. Any other error is rethrown, so it still fails server start as spec storage.md:253 says. The UPDATE sets only `public_code`, so the only unique violation it can raise is on `ix_user_public_code`. The savepoint is released on both paths, the same pattern as tx.ts:282-302. The new test server/core/storage/tests/create-user-conflict.test.ts:76 (PostgreSQL only) inserts `XXXXXXXX` in an uncommitted lock holder transaction, queues `XXXXXXXX` as the fill's first pick, commits after 500 ms while the start waits, and checks that start succeeds with `YYYYYYYY` and both queued picks were used. I ran `ogw core test server storage --file server/core/storage/tests/create-user-conflict.test.ts`: it passed in both the SQLite and the PostgreSQL run |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not restore the defect and run the new test against it myself. R1-1 is a `correctness` finding, so this was not required to judge it `fixed`. The core agent report says the test fails on PostgreSQL with schema.ts of d0b1247 (`duplicate key value violates unique constraint "ix_user_public_code"`), and the `fix test proof` of `ogw code check` checks this
- The new test depends on timing: the lock holder commits 500 ms after its run message. If server start took more than about 500 ms to reach the fill, the holder would commit first. The fill's `NOT EXISTS` would then see `XXXXXXXX` and pick again on the old path, and the test would pass without going through the savepoint path. On this host start reaches the fill well within that time and the test passed, but I did not measure the margin
- I ran only create-user-conflict.test.ts. I did not run the other storage test files or the dependent modules in this round. The core agent report says `ogw core test server` over storage and its dependents passed on SQLite and PostgreSQL
- The other changes in the range (friend, public-profile, BootstrapCore, TweenCore, test-data, records) are outside the storage target and were not reviewed. None of them touches server/core/storage
