# review coupon round 1

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

- In the range `cf89b7f..bb137f1` the coupon module changed only in `server/core/coupon/tests/expiry.test.ts:42,45`: the test reads `.deleted` of the `SweepResult` that `storage.sweep_expired` now returns instead of a number. `server/core/coupon/index.ts` and `server/core/coupon/code.ts` did not change and do not call `sweep_expired`
- The dependency changes in the range that reach coupon are in `storage`: `sweep_expired` deletes in batches per table with a time budget and returns the failed table list (`server/core/storage/rows.ts:385-407`), and `register_table` adds the index of the expiry column alone when no index starts with it (`server/core/storage/schema.ts:191-195`), with `CREATE INDEX IF NOT EXISTS` (`server/core/storage/schema.ts:201-203`). Coupon registers one table with an expiry column, `coupon_attempt` with `expires_at` and no index list (`server/core/coupon/index.ts:625-636`), so it now gets the `[expires_at]` index, as `storage` `### base table` sets. The SQLite batch delete selects by `rowid`, and no storage table is made `WITHOUT ROWID`. The `COUNT_ATTEMPT` upsert (`server/core/coupon/index.ts:172-175`) rewrites `expires_at` to the end of the current window, and the outer expiry condition of the PostgreSQL batch delete (`server/core/storage/rows.ts:372-378`) keeps a row that upsert rewrote after the inner select. So no finding comes from these changes
- The coupon server core tests were run only with `OGW_DEFAULT_DB` `sqlite` (7 files, 48 passed, with `OGW_SERVER_DATA` the `server/build/data` of `open-game-works-core-impl/`, since this checkout has no `server/build/`). The `postgresql` run was not made because no PostgreSQL connection was available to this review, so the PostgreSQL-only branch of `server/core/coupon/tests/expiry.test.ts:62` and the PostgreSQL batch delete by `ctid` on `coupon_attempt` were not run
- Code outside the range (the whole coupon module before `cf89b7f`) was not reviewed again, since the commit range is not `none`
