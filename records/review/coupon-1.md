# review coupon round 1

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

- In the range `2ef5ae8..b99875f` the coupon module changed only in `server/core/coupon/tests/expiry.test.ts:24` and `server/core/coupon/tests/grant-failure.test.ts:55,72`: the tests take `.user_id` from the `NewUser` that `storage.create_user` now returns. `server/core/coupon/index.ts` and `server/core/coupon/code.ts` did not change and do not call `create_user`. The dependency changes in the range that reach coupon are the random user IDs below 2^53 and the `public_code` column of `storage` (`server/core/storage/rows.ts`, `server/core/storage/public_code.ts`, `server/core/storage/schema.ts`). Coupon keeps user IDs only as bound `int64` values (`coupon_redemption.user_id`, `coupon_attempt.user_id`, `coupon_code.redeemed_by`) and never orders or numbers by them, and no coupon test expects an order or value of user IDs. So no finding comes from these changes
- The coupon server core tests were run only with `OGW_DEFAULT_DB` `sqlite` (48 passed, 4 runs, with `OGW_SERVER_DATA` the `server/build/data` of `open-game-works-core-impl/`, since this checkout has no `server/build/`). The `postgresql` run was not made because no PostgreSQL connection was available to this review, so the PostgreSQL-only branch of `server/core/coupon/tests/expiry.test.ts:62` and the PostgreSQL behavior of the changed `storage` (`ON CONFLICT DO NOTHING` insert of `create_user`, the start fill) under coupon tests were not checked
- Code outside the range (the whole coupon module before `2ef5ae8`) was not reviewed again, since the commit range is not `none`
