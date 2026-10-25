# review rating round 1

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

- The range 2ef5ae8d..683944f7 does not change `server/core/rating/` or `server/generated/data` rows of `rating_rule`, `rating_tier` and `match_mode`. The changes that reach `rating` are in `storage` (`create_user` returns `NewUser`, random user IDs below 2^53, core schema 2 with `public_code`) and in the test helpers of other modules. `rating` calls only `storage.get_state`, `list_state` and `put_core_state` and compares user IDs as bigint (`server/core/rating/index.ts:249`), so it does not depend on the order or size of user IDs. Its tests make users through `testing` `login` (`server/core/rating/tests/helpers.ts:96`). No finding came from these changes
- The `rating` core tests (8 files, 28 tests) were run with vitest only with `OGW_DEFAULT_DB` `sqlite`, and they all passed. The data was `server/build/data` of the `open-game-works-core-impl/` checkout at 5c34b66, which differs from 683944f only in `records/`. The PostgreSQL run was not done, because no PostgreSQL connection was set up for this review
- The data rules of `rating_rule` and `rating_tier` other than `mailbox.maxAttachments` (`scale` ≥ 1, `min_rating` ≤ `initial_rating`, the `reward_min_games` rules and the others) are checked by the data tool (`tools/data-tool/src/checks/rating.ts`). That code is outside this target and was not read
- The `matchmaker` side of the `get_rating` call inside `storage.run_rollback_transaction` and the guarantee of one apply per participant were not read again, because `matchmaker` did not change in the range. Only the path of `server/core/rating/tests/matchmaker.test.ts` was checked
