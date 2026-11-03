# review shop round 1

## findings

none

## previous

none

## out of scope

- server/core/shop/tests/hook.test.ts:45: medium `open-game-works-core/skills/server-core/SKILL.md:127` requires content hooks to run in `with_hook_change_source` with the change source of the purchase, and no shop test checks this for `validate_shop_purchase` or `on_shop_bought`. Only `server/core/shop/tests/extra.test.ts:18` reads `ctx.hook_change_source`, and only for `grant_shop_extra`. In a temporary clone, calling both hooks without `in_source` (`server/core/shop/index.ts:234`, `:270`) left all 45 shop tests passing on SQLite. A copy of that clone failed 37 of 45 tests in a control run that also inverted `on_sale`, so these runs do execute the changed code. It existed before the range.
- server/core/shop/index.ts:250: medium `open-game-works-core/skills/server-core/modules/shop.md:64` purchase order step 7 sets `once_key` `shop:<request ID>`, and no shop test checks it. `grep` for `once_key` over `server/core/shop/tests/*.test.ts` finds no assert on it. In the same temporary clone, passing an empty `once_key` at this line left all 45 tests passing, because `idempotency` answers the resend in `server/core/shop/tests/buy.test.ts` before the handler runs. It existed before the range.
- server/core/shop/tests/buy.test.ts:34: medium `open-game-works-core/skills/server-core/modules/shop.md:62` purchase order step 5 sets the cost `ref` to the decimal string of the product ID value, and the test checks only `source` of the cost `ItemChange`. In the same temporary clone, passing an empty `ref` at `server/core/shop/index.ts:240` left all 45 tests passing. It existed before the range.
- server/core/shop/index.ts:248: medium `open-game-works-core/skills/server-core/modules/shop.md:109` and `:110` set `INTERNAL` for a failure of `preview_add_items` and of `grant_or_mail`, and no test goes through either path. In a temporary clone, returning `pass` for a failed preview at this line, and accepting a failed `grant_or_mail` at `server/core/shop/index.ts:254` while answering `INTERNAL` for `AlreadyApplied`, left all 45 tests passing on SQLite. `open-game-works-core/skills/server-core/modules/mailbox.md:124` says the caller treats `AlreadyApplied` as granted, so that branch is also untested. It existed before the range.
- server/core/shop/index.ts:225: medium The order of steps 1 to 3 of the purchase order at `open-game-works-core/skills/server-core/modules/shop.md:58` has no test. In a temporary clone, moving the checks at lines 224 to 228 to the order limit, requirement, sale condition, request left all 45 tests passing on SQLite. With that order, a product that is both outside its window and at `limit_count` answers `SHOP_LIMIT_REACHED` instead of `SHOP_PRODUCT_UNAVAILABLE`. The wrong answer was read from the code, not run. It existed before the range.

## debt

none

## must fix

none

## unknown

- `git diff` of the range shows no change under `server/core/shop`, under the code of `item-ledger`, `mailbox`, `live-event`, `offer`, `validation`, `storage`, `server-time` and `logging`, under `server/generated`, under `test-data`, or in `proto/`. The range changes that can reach shop were checked as below, and the rest of the range was not reviewed.
- `tools/data-tool/src/corespec.ts` and `core-spec/validation.json` (the `requirement` table in the table closure and its header enums): `ogw core test tools data-tool` reports pass, including `tools/data-tool/tests/shop-checks.test.ts`. Data tool output for a real game that uses `shop` was not run.
- `ogw core test server shop` reports pass. That command can reuse a kept passing result, and whether this run reused one was not checked. The module's tests were run directly only on the temporary clones with restored defects, with vitest on SQLite. Those runs did not use PostgreSQL. The core tests of modules that depend on shop were not run.
- A mutation run can only show that a set of restored defects survives together. Each surviving set above passed 45 of 45, but no defect was run alone, so one defect hiding another in a set was not ruled out. The control that inverted `on_sale` was run once, on the first set of defects. The empty `ref` of the grant was also restored once by mistake and three tests failed, so that `ref` is covered.
- `server/core/shop/index.ts` was read whole against `## behavior`, `## hook` and `## error` of the shop spec, and `tools/data-tool/src/checks/shop.ts` against `## data`. No behavior defect was found. This was reading, and only the defects named above were restored.
- `offer.read_purchase_limit` and `change_failure_code` were read only at their definitions. The code of `mailbox`, `validation`, `live-event`, `logging`, `routing`, `idempotency` and `storage` was not read. Their behavior was taken from their specs and from the shop tests.
- A resend with the same request ID after `idempotency.responseRetentionMs` was read but not run. `idempotency` keeps that setting above the signature window and the client retry age at server start, so it was not judged. Client `UserStateCore.get_shop_purchase_count` was not read. It is outside this target.
