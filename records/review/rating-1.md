# review rating round 1

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

- The commit range changes no file under `server/core/rating/`. Of the modules that rating depends on, it changes only `storage` (`fail_transaction`: server/core/storage/tx.ts, server/core/storage/core.ts, server/core/storage/index.ts) and a comment in `logging` (server/core/logging/metrics.ts). Rating calls `get_state`, `put_core_state` and `list_state` (server/core/rating/index.ts:243, :268, :352), catches no throw, and does not call `fail_transaction`. So on a transaction that `fail_transaction` marked, those calls throw and the throw goes out of the rating operation unchanged, and the transaction ends `FAILED` (open-game-works-core/skills/server-core/modules/storage.md:149, :358). None of the rating rules in open-game-works-core/skills/server-core/modules/rating.md turns a storage throw into a value. The `fail_transaction` behavior itself belongs to the storage target and was not reviewed here
- `ogw core test server rating` passes on this checkout. The run kept no test record because the checkout had an uncommitted change (the deleted earlier `records/review/rating-1.md`). The core tests of the modules that depend on `rating` were not run, as `ogw review run` runs them
- The PostgreSQL runs of the rating tests were not checked separately. The run used the default test setup of `ogw core test`
