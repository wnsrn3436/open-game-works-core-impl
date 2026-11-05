# review coupon round 7

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

- Commit range `1ed6afe..c2d3992` changes one coupon file: `server/core/coupon/tests/admin.test.ts:213` drops `M\u0000` from the `after_code` list of the byte order test. Since the range, `admin-api` refuses a `string` field that holds U+0000 or an unpaired surrogate with 400 (`server/core/admin-api/body.ts` `string_of`, `server/core/admin-api/json.ts` `is_clean_text`), so that case no longer reaches `list_coupon_codes`. The `## test` item of `coupon.md` on `after_code` paging and the byte order of other characters is still checked by the remaining cases, and `server/core/coupon/tests/code.test.ts:17-18` still checks `code_bound_after` with U+0000 directly
- The round 6 `## unknown` item on a `create_coupon` `memo` holding U+0000 (500 `internal` from the `INSERT_COUPON` query): the `admin-api` string rule now refuses it with 400 before `create_coupon` runs, which is what `admin-api` sets for every `string` field. I did not run that request
- Changed dependency code that coupon reaches: `server/core/item-ledger/items.ts` `amount_of` now reads only the canonical big encoding pair (`read_encoded`). Coupon passes `create_coupon` `items` through `check_add_items` (`server/core/coupon/index.ts:506-507`), so a non-canonical pair is now `bad_request` there, which matches `item-ledger.md:34` and `coupon.md` ("Must pass `item-ledger.check_add_items`"). Coupon rows saved before this change with a non-canonical pair would now fail `grant_or_mail`/`send_mail` at `RedeemCoupon`; no PROD build exists for core, so I did not treat this as a compatibility problem. The `server/core/item-ledger/ledger.ts` changes concern changes of 0 or less and conversion overflow; coupon grants only amounts that `check_add_items` accepted (1 or more). The `routing` secret store change (`secret_reader` folder argument) does not touch coupon. `mailbox` and `storage` changed only tests in the range
- Run: `ogw core test server coupon` in this checkout at `c2d3992` gave `coupon pass` (both runs). I did not run the suites of modules that depend on coupon
