# review: validation round 1

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

- The commit range does not change `server/core/validation/`, `fixtures/` or `test-data/`. The changes that reach validation are those of its dependencies: `storage` (`fail_transaction` in `server/core/storage/tx.ts`, the `failed` mark of `TxState` and its check in `user_state_of` and `any_state_of` in `server/core/storage/core.ts`) and `item-ledger` (`server/core/item-ledger/ledger.ts`: `guard_write` no longer marks a hook misuse, a hook failure calls `storage.fail_transaction`; `server/core/item-ledger/history.ts`: `source` as an enum value, `once_key` hashing, the personal data user column of the history table)
- Checked the paths validation calls: `evaluate_requirement` runs the judge hooks inside `storage.run_read_only` (`server/core/validation/index.ts:96`), which now goes through `any_state_of` and its `failed` check; `run_read_only` decrements `read_only` in `finally`, so a throw of a judge hook, also a `guard_write` throw of an item-ledger write in a judge hook nested in `validate_item_change`, leaves the transaction state as before and reaches `call_hook` → `hook_failure` after the read-only scope ended. A judge hook that catches the `guard_write` throw goes on, as the item-ledger spec now sets (`item-ledger` `## hook`), and the same as a caught storage read-only misuse outside an item-ledger hook. Validation does not call `list_history`, `has_once_key` or `put_once_key`
- `ogw core test server validation` passed (run in this checkout, which has an uncommitted deletion of this review file, so no test record was kept). The tests of `storage` and `item-ledger` themselves were not run here: they belong to those targets
- Whether `ogw core test server` covers PostgreSQL for the validation tests was not checked
