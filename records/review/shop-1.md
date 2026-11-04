# review shop round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/shop/tests/hook.test.ts:45 | `open-game-works-core/skills/server-core/SKILL.md:127` requires content hooks to run inside `with_hook_change_source` with the change source of the purchase. `server/core/shop/index.ts:234` (`validate_shop_purchase` through `call_product_hook`) and `:270` (`on_shop_bought`) wrap the hook in `in_source`, but no test reads `ctx.hook_change_source` in these two hooks, or checks the `source`/`ref` of an item that `on_shop_bought` adds: `hook.test.ts:45` only checks the balance delta of `[shop_shard]`, and `hook.test.ts:15` only checks the arguments. The only read of `ctx.hook_change_source` is `server/core/shop/tests/extra.test.ts:18`, for `grant_shop_extra`. A run path where both hooks are called without `in_source` passes every shop test (input D1). | In the `validate_shop_purchase` test and the `on_shop_bought` test, record `ctx.hook_change_source` and assert `{source: Shop, ref: <product ID value>}`. Also assert `source` and `ref` of the `ItemChange` of `[shop_shard]` that `on_shop_bought` adds | no | 90 |
| R1-2 | test evidence | medium | server/core/shop/index.ts:250 | `open-game-works-core/skills/server-core/modules/shop.md:64` step 7 sets `once_key` `shop:<request ID>` for `grant_or_mail`. `grep once_key server/core/shop/tests/*.test.ts` finds no assert. The resend test `server/core/shop/tests/buy.test.ts:136` is answered by `idempotency` before the handler runs, so an empty or wrong `once_key` at `index.ts:250` passes every shop test (input D2). | Add a test that checks the `once_key` the reward grant uses, e.g. a second `grant_or_mail`/`add_items` with `once_key` `shop:<request ID>` in the same user after the purchase answers `AlreadyApplied`/`ALREADY_APPLIED`, or a read of the stored change source | no | 90 |
| R1-3 | test evidence | medium | server/core/shop/tests/buy.test.ts:34 | `open-game-works-core/skills/server-core/modules/shop.md:62` step 5 sets the cost `ref` to the decimal string of the product ID value. `buy.test.ts:32` to `:34` check only `delta` and `source` of the cost `ItemChange` of `[shop_gold]`; `ref` is asserted only for the reward (`buy.test.ts:31`, `overflow.test.ts:28`, `overflow.test.ts:83`). An empty `ref` at `server/core/shop/index.ts:240` passes every shop test (input D3). | Add `expect(gold?.ref).toBe(String(id('[shop_basic]')))` after `buy.test.ts:34` | no | 92 |
| R1-4 | test evidence | medium | server/core/shop/index.ts:248 | `open-game-works-core/skills/server-core/modules/shop.md:109` and `:110` set `INTERNAL` for a failure of `grant_or_mail` and of `preview_add_items`. `grep INTERNAL server/core/shop/tests/` finds only the hook output and hook throw tests (`hook.test.ts:32`, `:67`, `extra.test.ts:31`); no test goes through `index.ts:248` or `index.ts:254`. `open-game-works-core/skills/server-core/modules/mailbox.md:124` says the caller treats `AlreadyApplied` as granted, and the `AlreadyApplied` branch at `index.ts:254` is not reached by any test either. Returning `pass` at `:248` or accepting a failed `grant_or_mail` at `:254` passes every shop test (input D4). | Add tests that make `preview_add_items` and `grant_or_mail` fail (e.g. a reward item the ledger answers `UNSUPPORTED_ITEM` or `UNKNOWN_ITEM` for, from core test data) and assert `INTERNAL` with nothing changed, and a test where `grant_or_mail` answers `AlreadyApplied` and the purchase succeeds with empty `items` | no | 85 |
| R1-5 | test evidence | medium | server/core/shop/index.ts:225 | `open-game-works-core/skills/server-core/modules/shop.md:58` to `:60` order the request check, the sale condition (`SHOP_PRODUCT_UNAVAILABLE` before `SHOP_PRODUCT_LOCKED`) and the purchase limit. The code at `index.ts:221` to `:228` follows that order, but no test has a product that fails two of these checks at once: `sale.test.ts:69` and `sale.test.ts:116` answer `SHOP_PRODUCT_UNAVAILABLE` when the stored count is already reset (reset_at reached or new round), `sale.test.ts:40` has a product that is on sale, and `limit.test.ts` products are on sale. Moving the checks at `:224` to `:228` into another order passes every shop test (input D5). | Add tests where a product is outside its window and at `limit_count`, and where it is outside its window and the requirement is not passed, and assert `SHOP_PRODUCT_UNAVAILABLE`; and one where `max_quantity` is exceeded on a product outside its window, asserting `INVALID_REQUEST` | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `server/core/shop/index.ts` and `server/core/shop/tests/` are unchanged since the initial commit (`git log -- server/core/shop` shows only `301b3dd`). `ctx.hook_change_source` is read only at `server/core/shop/tests/extra.test.ts:18` |
| D2 | open | R1-2 | No assert on `once_key` in `server/core/shop/tests/*.test.ts`; code and tests unchanged |
| D3 | open | R1-3 | `server/core/shop/tests/buy.test.ts:32` to `:34` still check no `ref` of the cost `ItemChange` |
| D4 | open | R1-4 | No test reaches `server/core/shop/index.ts:248` or the failure and `AlreadyApplied` branches of `:254` |
| D5 | open | R1-5 | No test has a product failing two of the steps 1 to 3 at once; order of `server/core/shop/index.ts:221` to `:228` untested |

## must fix

none

## unknown

- The commit range `ab2748a..ab2748a` is empty, so no change in the range caused or revealed a problem. The findings are only the input `## debt` items, which remain open.
- The mutation runs of the input debt items were not run again: this checkout and `open-game-works-core-impl/server/` have no `node_modules`, so vitest could not run here. The results of D1 to D5 come from reading the code and tests, which are unchanged since the commit those runs were made on (`git log -- server/core/shop` shows only the initial commit).
- The whole of `server/core/shop/tests/helpers.ts` was not read line by line; only the parts that the tests above use were checked.
