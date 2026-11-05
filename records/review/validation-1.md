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

- The commit range 51d323b..73632c2 changes no file under `server/core/validation/`. Checked the changes in the range that the validation code calls or that its judge hooks use: `storage` `run_read_only` (unchanged), the new transaction end rule of `server/core/storage/tx.ts` `body` (a judge hook write inside `run_read_only` throws `StorageMisuse`, which does not mark the transaction broken, so the request still ends `INTERNAL` with saved state unchanged), `mark_broken` and `broken_by` of `server/core/storage/core.ts`, the new `get_states` of `server/core/storage/state.ts` (its read conversion does not save inside `run_read_only` because `user_persist` returns null there), and the `server/core/item-ledger/` changes (`read_encoded`, the limit skip for a net change of 0 or less, history seq). None of them changes a result that `validate_request`, `validate_message`, the helpers or `evaluate_requirement` give
- `ogw core test server validation` passed. Which DBs that run covered was not read from its output, which printed only `validation pass` twice
- Problems of the validation code that existed before the range were not searched for, because they are not findings of a review with a commit range and were not found while checking the changed paths
