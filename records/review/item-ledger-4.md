# review item-ledger round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | server/core/item-ledger/items.ts:62 `read_encoded` returns null when `big_amount` is '' and \|`amount`\| > 2^53−1, and when `big_amount` is not '' and (`amount` ≠ 0, `big_amount` not a big integer, or \|value\| ≤ 2^53−1); `amount_of` (items.ts:70) uses it, so `parse` (ledger.ts:367), the module's `read_amount` (index.ts:133) and `send_mail` attachments (mailbox/mail_input.ts:88) reject the pairs of item-ledger.md:393. The lenient `read_big` stays only on the history read (history.ts:86) and DEV `SetItemBalance` (dev/index.ts:35), which item-ledger.md:320 allows. Other callers of `read_amount` read data `ItemAmount`s, which the data tool writes in the big encoding (tools/data-tool/tests/item-amount.test.ts:80). Restored the old items.ts and ledger.ts from 0c2c239 in a temporary worktree outside the target checkout and ran `ogw core test server item-ledger mailbox`: big.test.ts "an ItemAmount pair that is not the big encoding of an integer is INVALID_AMOUNT …" failed (10^19/'' gave `OK`) and send-mail.test.ts "refuses an attachment of a max_digits 20 big item whose amount, big_amount is not the big encoding of an integer" failed (10^19/'' gave `OK`), in both the SQLite and PostgreSQL runs; on the target checkout both pass |
| R3-2 | fixed | server/core/item-ledger/ledger.ts:737 guard is now `d <= 0n \|\| next <= balance_limit`, so a net 0 or negative change of a balance saved above `max_amount` is not judged; ledger.ts:745 pushes a `Convert` overflow only when `d > applied`; the timed branch (ledger.ts:725) judges the cap only when `d > 0n`. With the old ledger.ts restored in the temporary worktree, change.test.ts "a balance saved over a smaller max_amount: …" failed at the `[ticket]` (`Reject`, saved 7 > 5) net 0 `exchange_items` in both runs; on the target checkout it passes and also checks the `Discard` and `Convert` (`[shard]` 12 > 10, nothing granted to `[dust]`) cases and no history row |
| R3-3 | fixed | One test per listed `## test` item, each checking what the item sets: item-ledger.md:366 group.test.ts "subtracting group G 1 and adding its member F 1 at max_amount with P at 0: …" (`Reject` `LIMIT_EXCEEDED` with balance and history unchanged; `Discard` one `ItemChange` `delta` −1 `overflow` 1, F 9); item-ledger.md:367 hooks.test.ts "an exchange subtracting 1 and adding 1 of X and adding 1 of Y …" (both hook lists `[potion]` only); item-ledger.md:375 change.test.ts "content add_items with source Recovery outside with_hook_change_source records source Request" (`ItemChange` and history source `Request`); item-ledger.md:382-383 change.test.ts "item_changes order: …" (X (0, 1) then Y (1, `Overflow`, ref X) with both hook lists X, Y and Y `after` = `before` + 1; B, A, M; X, M; X1, Y, X2, Y with `delta`/`overflow` and history rows as the item states); item-ledger.md:388 revoke.test.ts "revoke_items of X 3 and Y 1 with X at 0 and Y at 1: …" (`item_changes` Y only, history X (0, 3) and Y (−1, 0), one `audit` line for Y). The test data rows added in test-data/data/tables/item.csv, item_group.csv, item_overflow.csv give the `max_amount`, `overflow` and `convert_to` those items need. All pass in `ogw core test server item-ledger mailbox` on the target checkout |

## out of scope

none

## debt

none

## must fix

none

## unknown

- R3-3 was a `spec` finding (behavior without a test), not a `test evidence` finding, so no defect was restored for its tests; they pass both on the old and the new code because the order and filters they check were already right (the core agent report says the same)
- Only `ogw core test server item-ledger mailbox` was run (target checkout and the temporary worktree with the old items.ts and ledger.ts, which was removed afterwards). The other modules that call `read_amount` (shop, loot-table, mailbox reads of stored attachments) were checked by reading: they pass data `ItemAmount`s, hook outputs or attachments that the strict reader already accepted at `send_mail`; their test suites were not run in this round
- The changes in the range to ads-reward, nickname and Godot SceneCore do not touch item-ledger code or an operation it calls, and were not reviewed
