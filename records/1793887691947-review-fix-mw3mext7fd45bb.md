# review fix item-ledger round 3

## done

- `server/core/item-ledger` fixed: `read_amount`, `add_items`, `subtract_items`, `exchange_items` and every input check that uses `amount_of` now take only an `ItemAmount` in the contract's big encoding; a net change of 0 or less is not judged against `max_amount`
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written
- Core test data: added items `[ledger_group_r]`, `[ledger_paid_r]`, `[ledger_free_r]`, `[ledger_group_d]`, `[ledger_paid_d]`, `[ledger_free_d]` (two groups whose member F is `Reject` / `Discard` at `max_amount` 10) and `[ledger_convert_1]`, `[ledger_convert_2]` (`Convert`, each with `convert_to` `[ledger_convert_target]` 1) and `[ledger_convert_target]` (`Discard`, `max_amount` 5) to `test-data/data/tables/item.csv`, `item_group.csv`, `item_overflow.csv`. Names are empty, so no translation or glossary rows are needed
- Last `ogw core test server` over item-ledger and every server module from `ogw core dependents item-ledger`: all pass. `ogw code check core`: all checks pass

## spec proposals

none

## review

- R3-1 fixed: `server/core/item-ledger/items.ts:62` adds `read_encoded`. It returns null when `big_amount` is '' and |`amount`| > 2^53−1, and when `big_amount` is not '' and `amount` ≠ 0, `big_amount` is not a big integer, or |value| ≤ 2^53−1. `amount_of` (items.ts:70) uses it, so `parse` (ledger.ts), the module's `read_amount` and `send_mail` attachments through `mail_input.ts` reject these pairs. The history read (history.ts:86) and DEV `SetItemBalance` (dev/index.ts:35) still use the lenient `read_big`: the spec says `SetItemBalance` is `INVALID_REQUEST` only when `big_balance` is not a big integer. Tests: `big.test.ts` "an ItemAmount pair that is not the big encoding of an integer is INVALID_AMOUNT for max_digits 20 and changes nothing" (`add_items` with 10^19/'', 2^53/'', 1/'9007199254740993', 0/'9007199254740991', 0/'0'; also `read_amount` null and `check_add_items` `INVALID_AMOUNT`; a well-formed big pair still applies), and `mailbox/tests/send-mail.test.ts` "refuses an attachment of a max_digits 20 big item whose amount, big_amount is not the big encoding of an integer" (`INVALID_INPUT` for the three spec pairs; a well-formed pair is `OK`). The big.test case failed on the old `items.ts` (10^19/'' was `OK`) and passes after the fix
- R3-2 fixed: `server/core/item-ledger/ledger.ts:739` guard is now `d <= 0n`. `ledger.ts:745` pushes a `Convert` overflow only when `d > applied`, and the timed path (ledger.ts:727) judges the cap only when `d > 0n`. Test: `change.test.ts` "a balance saved over a smaller max_amount: …" (item-ledger.md:365): `Discard` `[potion]` saved at 15 (max 10) + 1 keeps 15 with `ItemChange` `delta` 0 `overflow` 1, −1 gives 14; timed `Discard` `[boost_discard]` with 4 h remaining (cap 3 h) + 1 keeps `ends_at` with `overflow` 1; `exchange_items` −1 +1 of `Reject` `[ticket]` (7 > 5), `Discard` `[potion]` and `Convert` `[shard]` (12 > 10) is `OK`, keeps the balance, has no `ItemChange`, no delta, no history row, and grants nothing to `[dust]`. This test failed on the old `ledger.ts` and passes after the fix
- R3-3 fixed: one test per listed `## test` item
  - item-ledger.md:366: `group.test.ts` "subtracting group G 1 and adding its member F 1 at max_amount with P at 0: …" (`Reject` `LIMIT_EXCEEDED` with nothing changed; `Discard` `OK`, F 9, one `ItemChange` `delta` −1 `overflow` 1, one history row)
  - item-ledger.md:367: `hooks.test.ts` "an exchange subtracting 1 and adding 1 of X and adding 1 of Y passes both hooks a list with Y and not X"
  - item-ledger.md:375: `change.test.ts` "content add_items with source Recovery outside with_hook_change_source records source Request" (`ItemChange` and history)
  - item-ledger.md:382-383: `change.test.ts` "item_changes order: …" (exchange −Y +Y +X with X `Convert` → Y gives X (0, 1) then Y (1, `Overflow`, ref X) and both hook lists X, Y with Y `after` = `before` + 1; −B −G +A gives B, A, M; `subtract_items` G 2, X 1 gives X, M; −X1 1 +X2 1 +X1 2 gives X1 (0, 1), Y (1, 0), X2 (0, 1), Y (0, 1) with the same history rows)
  - item-ledger.md:388: `revoke.test.ts` "revoke_items of X 3 and Y 1 with X at 0 and Y at 1: …" (`item_changes` Y only, history X (0, shortfall 3) and Y (−1, 0), one `audit` line for Y)

## unverified

- The new R3-3 tests pass on the code before and after the fix; they guard the order and filters but no defect was reproduced for them (the review also found none)
- Client core tests were not run: only server code changed. The added core test data rows do not touch any client module's table rows, but no client run checked this
