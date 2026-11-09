# review: gacha round 1

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

- The commit range `625ae189..32b266a0` changes no file under `server/core/gacha/`. The review covered the changes in the modules gacha calls: `server/core/item-ledger/ledger.ts` and `history.ts` (hook failures now call `storage.fail_transaction` and throw without the `hook_misuse` rethrow, `core_source` leaves no log, `once_key` stored as its SHA-256, an unpaired-surrogate `once_key` throws, history `source` read as the enum value, history personal data user column), `server/core/storage/core.ts`, `index.ts` and `tx.ts` (`fail_transaction`, `not_failed` in `user_state_of` and `any_state_of`, `body` returning `FAILED` for a marked transaction), `server/core/logging/metrics.ts` (comment only) and `core-spec/storage.json`. None of them changes a result gacha relies on. Gacha's cost `subtract_items` passes the empty `once_key`. Its grant `once_key` `gacha:<request ID>` holds a request ID that `server/core/routing/http.ts:44` limits to a UUID v4, so it is well formed, and `mailbox` keeps its own `once_key` table (`server/core/mailbox/tables.ts:104`), which the hashing does not touch. Gacha reads no item-ledger history row. An item-ledger hook failure inside `DrawGacha` (cost, grant, or a write from a gacha hook that catches the throw) now makes the transaction `FAILED`, so `routing` step 13 answers `INTERNAL` and nothing is saved. That is the same result as the uncaught throw before, and it matches the gacha `## error` rows and the `on_gacha_drawn` `## test` item
- `ogw core test server gacha` was run once at `32b266a0` in this worktree and passed both times it reported (`gacha pass` twice). It kept no test record because the checkout has the uncommitted deletion of this review file
- Whether `gacha_draw_record` should be given a personal data user column, now that the range gives `item_ledger_history` one as a "purchase and spending record", was not judged. The gacha spec (`### draw record`) registers it without one, the code follows that (`server/core/gacha/records.ts:66`), and the cost and grant changes of a draw already reach the export through the `item_ledger_history` rows with source `Gacha`
- Client modules were not reviewed: gacha is a server module and the range changes no gacha client code
