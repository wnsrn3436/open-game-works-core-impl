# review shop round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | In a temporary copy of the checkout outside the target checkout (SQLite run, 53 shop tests, all pass unchanged), calling `validate_shop_purchase` at `server/core/shop/index.ts:284` through `storage.check_hook_output` without `in_source` failed `server/core/shop/tests/hook.test.ts:18` (`changes nothing when validate_shop_purchase, called in the change source of the purchase, returns a GameError`); calling `on_shop_bought` at `server/core/shop/index.ts:270` without `in_source` failed `hook.test.ts:49` (`calls on_shop_bought once per purchase that succeeds, in the change source of the purchase, ...`), which now asserts `ctx.hook_change_source` and the `source`/`ref` of the `[shop_shard]` `ItemChange` |
| R1-2 | fixed | In the same copy, `once_key` `''` and `once_key` `shop-<request ID>` at `server/core/shop/index.ts:250` each failed `server/core/shop/tests/buy.test.ts:38` (history rows assert `once_key` `shop:<request ID>` for the reward) and `server/core/shop/tests/grant.test.ts:52` (`AlreadyApplied` only for the exact key) |
| R1-3 | fixed | In the same copy, `ref: ''` in `subtract_items` at `server/core/shop/index.ts:240` failed `server/core/shop/tests/buy.test.ts:35` (cost `ItemChange` `ref`) and `buy.test.ts:38` (cost history row `ref`) |
| R1-4 | fixed | In the same copy: a failed preview returned as `pass` at `server/core/shop/index.ts:248`, and a failed preview ignored (falling through to the grant), each failed `server/core/shop/tests/grant.test.ts:23`; a failed `grant_or_mail` returned as `pass` at `index.ts:254` failed `grant.test.ts:38`; `AlreadyApplied` returned as `INTERNAL`, and `AlreadyApplied` filling `items` with the reward, each failed `grant.test.ts:52`. The failure results of `preview_add_items` and `grant_or_mail` are stubbed with `vi.spyOn` on the instance module objects; the restored defects show the stub reaches the shop calls |
| R1-5 | fixed | In the same copy: moving the purchase limit check before the sale condition at `server/core/shop/index.ts:225` failed `server/core/shop/tests/sale.test.ts:136` and `sale.test.ts:160`; moving the requirement check before the sale condition failed `sale.test.ts:149`; moving the `max_quantity` check after the purchase limit failed `sale.test.ts:171` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: `server/core/shop/tests/hook.test.ts:18` and `:49` assert `ctx.hook_change_source` `{source: Shop, ref: <product ID value>}` in `validate_shop_purchase` and `on_shop_bought`, and each fails when its hook is called without `in_source` |
| D2 | fixed | none | Same as R1-2: `server/core/shop/tests/buy.test.ts:38` and `server/core/shop/tests/grant.test.ts:52` fail on an empty or wrong `once_key` at `server/core/shop/index.ts:250` |
| D3 | fixed | none | Same as R1-3: `server/core/shop/tests/buy.test.ts:35` fails on an empty cost `ref` at `server/core/shop/index.ts:240` |
| D4 | fixed | none | Same as R1-4: `server/core/shop/tests/grant.test.ts:23`, `:38`, `:52` go through the `preview_add_items` failure, the `grant_or_mail` failure and the `AlreadyApplied` branch, and fail when each branch is changed |
| D5 | fixed | none | Same as R1-5: `server/core/shop/tests/sale.test.ts:136`, `:149`, `:160`, `:171` fail when steps 1 to 3 at `server/core/shop/index.ts:221` to `:228` are put in another order |

## must fix

none

## unknown

- The restore runs were made with `OGW_DEFAULT_DB` `sqlite` only, on a copy of this checkout with the server build data of `open-game-works-core-impl/server/build/data` (same commit `ac935dc`). The PostgreSQL run was not made; the changes in the range are only shop tests and test helpers, and `server/core/shop/index.ts` is unchanged.
- The changes in the range outside `server/core/shop/` that shop calls (`server/core/item-ledger/history.ts`, `server/core/item-ledger/ledger.ts`: the history `seq` over unexpired rows and the upsert) were read only for their effect on shop: shop passes `source`, `ref` and `once_key` the same way, and every shop test passes with them. Their own correctness is the scope of the `item-ledger` review.
- `module_of` in `server/core/shop/tests/helpers.ts:247` reads `server.running().instance.modules()`, the same access other module tests use (e.g. `server/core/auth/tests/transaction-failure.test.ts:47`, `server/core/cheat/tests/processing.test.ts:115`); whether that access is part of the public `testing` API was not judged in this review.
