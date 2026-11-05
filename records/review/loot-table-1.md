# review loot-table round 1

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

- Commit range 51d323b..d593421 changes no file under `server/core/loot-table/`. The changes that reach loot-table are: `read_amount` of item-ledger (`server/core/item-ledger/items.ts:65`, now `read_encoded`, which rejects a non-canonical big encoding pair) that loot-table calls in `amount_of` (`server/core/loot-table/index.ts:136`), and the test data rows `[gacha_lt_over]`, `[gacha_lt_half]` in `test-data/data/tables/loot_table.csv:44`. Checked: the data tool writes an `ItemAmount` amount canonically (`tools/data-tool/src/binary.ts:187`: small field up to 2^53−1, `big_amount` only above it), and `LootResult.items` and `LootRate.items` are made by `make_item_amount` (`write_big`), so every amount that `roll`, `sum_items` and `get_rates` read is still read. The new rows meet the `loot_table` data rules (`Guaranteed`, weight 0, items not empty, each amount at most 2^53−1); `[gacha_lt_over]` gives `AMOUNT_OVERFLOW` in one `LootResult`, which `server/core/gacha/tests/draw.test.ts:271` relies on
- Not checked: `sum_items` given a `LootResult` whose `items` were built or changed by the caller with a non-canonical big encoding pair throws in `amount_of` instead of returning a failure value; the spec input is `LootResult` of `roll`, and no core caller in the range passes such a list (`server/core/gacha/index.ts:297` passes `roll` results unchanged), so it was not written as a finding
- The loot-table core tests were run with vitest once on SQLite, using the server build data of `open-game-works-core-impl/server/build/data` (this checkout has no `server/build/`): 5 files, 37 tests passed. The PostgreSQL run and the data-tool tests of the `loot_table` data checks (`tools/data-tool/src/checks/loot-table.ts`, unchanged in the range) were not run
- The gacha changes in the range (`server/core/gacha/index.ts`) are the gacha target and were read only for their calls of `roll` and `sum_items`
