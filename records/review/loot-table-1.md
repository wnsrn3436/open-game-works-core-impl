# review: loot-table round 1

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

- The commit range 625ae189..ae259834 changes no file under `server/core/loot-table/`, no generated data or contract code, and no loot-table spec (`## spec changes` is `none`). It changes the dependencies `storage` (`fail_transaction`, `not_failed` in `server/core/storage/core.ts`, `server/core/storage/tx.ts`), `item-ledger` (hook failure handling and `once_key` hashing in `server/core/item-ledger/ledger.ts`, `server/core/item-ledger/history.ts`) and `logging` (a comment in `server/core/logging/metrics.ts`). loot-table calls only `storage.random_weighted`, `item-ledger.amount_limit`, `read_amount`, `make_item_amount` and `logging.write` (`server/core/loot-table/index.ts:12-31`). The range does not change these, so it causes and reveals no loot-table finding
- A `roll` called on a ctx whose transaction `fail_transaction` marked (e.g. from a hook that caught an item-ledger hook failure) follows whatever `storage.random_weighted` does on that transaction. That is `storage` behavior and was not checked in this review
- Ran `ogw core test server loot-table` on this checkout: loot-table `pass`. The whole core suite was not run
- The loot-table code that existed before the range and that the range did not change was not reviewed against the spec as a whole, as the commit range is not `none`
