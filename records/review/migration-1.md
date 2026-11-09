# review: migration round 1

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

- The commit range 625ae189..1b25bfa2 changes no file under `server/core/migration/` and no `migration.*` settings key. I reviewed the changes in the modules that migration depends on and calls. In `storage` (`core.ts`, `tx.ts`, `index.ts`, `core-spec/storage.json`), the new `fail_transaction` sets `TxState.failed`. `user_state_of` and `any_state_of` throw only when `failed` is set, and `body` returns `FAILED` only when `failed` is set. The only non-test caller of `fail_transaction` is `server/core/item-ledger/ledger.ts`. Migration's storage paths do not reach it: `run_user_transaction` with `upgrade_user_rows` and read conversion through `convert_item`, `run_game_transaction` with `lock_game_row` and `db` in `insert_converter_rows`, `finish_step`, the lease take, `start_migration_batch` and `stop_migration_batch`, and `read_db` with `scan_users`. So the batch result mapping (`COMMITTED`, `REJECTED`, `FAILED`, `WITHDRAWN`) and the `FAILED` results of the game transactions do not change. In `logging`, the only change to `metrics.ts` is a doc comment. `server-time` has no change in this range
- `ogw core test server migration` passed in this checkout (job mw8m1x37e9a5db). It wrote no test record because the checkout has an uncommitted change: the deleted earlier review file at this output path. I did not check which DB targets that run used, and I did not run the migration tests against PostgreSQL on their own
- I did not review in full the migration code from before this range, because the range does not change migration. I read only the paths above
