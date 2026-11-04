# review rating round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/rating/index.ts:224 | Debt D1 is still open. `server/core/rating/` has not changed since the initial commit 301b3dd (`git log -- server/core/rating`), and the commit range is empty. `grep ALREADY_SENT server/core/rating/tests/` finds nothing. Each season test (`server/core/rating/tests/season.test.ts:56-191`) sends the first mail of its `once_key`, so no test reaches the `ALREADY_SENT` branch of line 224 that `rating` `### season settle` requires ("`ALREADY_SENT` counts as success") | Add a test. Send a mail with `once_key` `rating:<rule ID value>:<past season>` first, advance the season with `ranking.close_season_now`, then call `RefreshRating`. Check that the call succeeds, the settled row is written and there is no second mail | no | 90 |
| R1-2 | test evidence | medium | server/core/rating/index.ts:225 | Debt D2 is still open. The code and tests have not changed. No test makes `mailbox.send_mail` return `INVALID_INPUT` during a settle: the season tests use the valid `[mail_rating_season]` template and the valid `[rating_tier_*]` rewards of `test-data/data/tables/rating_tier.csv`. Nothing covers the `rating` `## error` row "`INVALID_INPUT` from season reward `send_mail` \| throw \| `INTERNAL`" | Add a test in which `send_mail` returns `INVALID_INPUT` during `RefreshRating` after a season change. Check that the response is `INTERNAL`, the row stays unsettled and no mail is sent | no | 85 |
| R1-3 | test evidence | medium | server/core/rating/index.ts:195 | Debt D3 is still open. Every `set_rating` value in `server/core/rating/tests/` is within a few thousand (dev.test.ts:10, season.test.ts:89,133,186, match-outcome.test.ts:124,134), so `apply_permille(rating − 1000, 500)` never overflows. The `!scaled.success` throw of the `rating` `## error` row "failure of `validation.apply_permille` in step 2 of season settle" has no test | Add a test. Call `set_rating` with 2^60 on `[rating_rule_basic]`, advance the season, then call `RefreshRating`. Check that the response is `INTERNAL` and the row is unchanged | no | 85 |
| R1-4 | spec | medium | server/core/rating/index.ts:192 | Debt D4 is still open. `current_season` (index.ts:171) returns 0n for a rule whose `season_board` is `null`, and `settle_row` settles any stored row whose `season` is not 0n. `rating` `## data` says that a `null` board has "a single season 0 and no settle". Run path: a `[rating_rule_seasonless]` row with `season` 5 (from game data that later changed the board to `null`, or from `put_core_state`) is soft reset with `season_games` set to 0 by `get_rating`, and `RefreshRating` writes it (index.ts:320-321) | Skip settle when `rule.season_board === 0` in `settle_row`, and add the case of a past `season` value on a seasonless rule to the test at season.test.ts:220 | no | 85 |
| R1-5 | test evidence | medium | server/core/rating/index.ts:197 | Debt D5 is still open. With `[rating_rule_basic]` (`min_rating` 0, `soft_reset_target` 1000, `soft_reset_permille` 500), the clamp of step 2 is reached only when the rating before settle is below −1000. Every settled rating in the tests is 1064, 1300 or 1236+64 (season.test.ts:64,89,133), so no test reaches the clamp. The helper `soft_reset` (season.test.ts:32-38) computes the clamp itself, so even a test that reached it would compare against its own copy of the rule | Add a test. Call `set_rating` with −3000 on `[rating_rule_basic]`, advance the season, call `RefreshRating`, and check that the row rating is the literal 0 | no | 90 |
| R1-6 | test evidence | medium | server/core/rating/index.ts:212 | Debt D6 is still open. Every settled row in the tests has a rating of 0 or more on `[rating_rule_basic]`, whose `[rating_tier_bronze]` has `min_rating` 0, so the past season tier is never 0. Nothing tests the `settled.tier_id === 0` guard, and without that guard `RatingTierTable.get_row(0)` would be called | Add a test. Call `set_rating` with −3000 on `[rating_rule_basic]`, advance the season, call `RefreshRating`, and check that the call succeeds and no mail is sent | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `server/core/rating/index.ts` and `server/core/rating/tests/` have not changed since 301b3dd. There is still no `ALREADY_SENT` case in the tests |
| D2 | open | R1-2 | No test makes the season reward `send_mail` return `INVALID_INPUT`. The code has not changed |
| D3 | open | R1-3 | No test uses a rating large enough to overflow `apply_permille`. The code has not changed |
| D4 | open | R1-4 | index.ts:171 and :192 are unchanged. A seasonless rule still settles a row whose `season` is not 0 |
| D5 | open | R1-5 | No test rating is below −1000 on the basic rule, and the `soft_reset` helper at season.test.ts:32 still computes the clamp itself |
| D6 | open | R1-6 | No settled test row has tier 0 on a rule with rewards. Bronze `min_rating` is 0, and every test rating is 0 or more |

## must fix

none

## unknown

- The commit range f8ed28b..f8ed28b is empty, and `server/core/rating/` has not changed since the initial commit, so the only findings are the debt items. I made no new full-target review
- I did not repeat the mutation runs of D1, D2, D3, D5 and D6 in a temporary copy, and I did not run the D4 reproduction again. The code and tests are byte-identical to what those runs used (no commit touches `server/core/rating/` after 301b3dd, and the debt line numbers match the current code). My results come from reading the code, tests and test data (`test-data/data/tables/rating_rule.csv`, `rating_tier.csv`)
