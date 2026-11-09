# review: tutorial round 1

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

- The commit range 625ae189..ee4490d1 changes no file under `server/core/tutorial/`. The review covered the changes of that range in what tutorial calls: `storage` (the range adds `fail_transaction`, and `user_state_of` and `any_state_of` in `server/core/storage/core.ts` now throw on a transaction that `fail_transaction` marked; tutorial never calls `fail_transaction`, so `get_state`, `put_core_state` and `delete_core_state` keep the input, output and failure value it relies on), `logging` (`server/core/logging/metrics.ts` changes only a comment; `write` and `track_core_event` are unchanged), `session` (`end_session` now deletes only the current session; tutorial does not call it), the settings schema (`admin-api.maxSearchRows` minimum; tutorial has no settings) and `core-spec/storage.json` (adds `fail_transaction`). The range changes neither the generated core contract nor the tutorial tests
- `ogw core test server tutorial` passed on this checkout. The tests of `storage`, `logging` and `session` themselves were not run: they belong to the reviews of those modules
- Problems of the tutorial code that existed before the range and that the range does not reveal were not looked for, as the commit range is not `none`
